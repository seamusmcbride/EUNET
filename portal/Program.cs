using System.Diagnostics;
using System.Security.Claims;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.StaticFiles;
using Portal;

var builder = WebApplication.CreateBuilder(args);

var dataDir = Directory.CreateDirectory(builder.Configuration["DataDir"] ?? Path.Combine(builder.Environment.ContentRootPath, "data")).FullName;
const long MaxUpload = 100 * 1024 * 1024;

builder.Services.AddSingleton(sp => new UserStore(dataDir, sp.GetRequiredService<ILogger<UserStore>>()));
builder.Services.AddSingleton(new FileStore(Path.Combine(dataDir, "files")));
builder.Services.AddSingleton(new AuditLog(Path.Combine(dataDir, "audit.log")));
builder.Services.AddSingleton<CertAuth>();
// Keep the keys that encrypt sign-in cookies with the data, so restarts and upgrades don't sign everyone out
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(Directory.CreateDirectory(Path.Combine(dataDir, "keys")))
    .SetApplicationName("EUNET");
// When the portal serves HTTPS itself and certificate sign-in is on, ask browsers for a client certificate.
// It's optional at the TLS level so password sign-in keeps working; the sign-in endpoint does the real checks.
if (!string.IsNullOrWhiteSpace(builder.Configuration["ClientCertificates:TrustedCaFile"]))
    builder.WebHost.ConfigureKestrel(k => k.ConfigureHttpsDefaults(h =>
    {
        h.ClientCertificateMode = Microsoft.AspNetCore.Server.Kestrel.Https.ClientCertificateMode.AllowCertificate;
        h.AllowAnyClientCertificate();
    }));
builder.Services.AddHttpClient("ollama", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Ollama:Url"] ?? "http://localhost:11434");
    c.Timeout = TimeSpan.FromMinutes(5); // Small machines can take a while on long answers
});
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = MaxUpload);

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "eunet.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // Always secure once served over HTTPS
        o.ExpireTimeSpan = TimeSpan.FromHours(8);
        o.SlidingExpiration = true;
        // API callers get status codes, not redirects to a login page
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("admin", p => p.RequireRole("admin"));

// Five sign-in attempts per minute per client address
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();
var started = DateTimeOffset.UtcNow;

// Behind a cloud load balancer or reverse proxy, take the client address and HTTPS from its headers.
// Only enable this when the app can't be reached except through the proxy, or the headers could be forged.
if (app.Configuration.GetValue<bool>("TrustForwardedHeaders"))
{
    var fwd = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto, ForwardLimit = 1 };
    fwd.KnownIPNetworks.Clear();
    fwd.KnownProxies.Clear();
    app.UseForwardedHeaders(fwd);
}
if (!app.Environment.IsDevelopment()) app.UseHsts();

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["Referrer-Policy"] = "same-origin";
    h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()";
    h["Content-Security-Policy"] =
        "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    // State-changing API calls must carry this header; browsers can't add it cross-site without CORS
    if (ctx.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(ctx.Request.Method)
        && ctx.Request.Headers["X-EUNET"] != "1")
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsync("Missing request header.");
        return;
    }
    try { await next(); }
    catch (Exception e) when (e is UnauthorizedAccessException or ArgumentException && !ctx.Response.HasStarted)
    {
        // Bad paths and names are the caller's mistake, not a server error
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

// ---------- Sign-in ----------
api.MapPost("/login", async (LoginRequest req, UserStore users, AuditLog audit, HttpContext ctx) =>
{
    var user = users.Verify(req.Name?.Trim() ?? "", req.Password ?? "");
    if (user is null)
    {
        audit.Write(ctx, "login-failed", user: req.Name);
        return Results.Json(new { error = "Wrong user name or password." }, statusCode: 401);
    }
    var identity = new ClaimsIdentity(
        [new(ClaimTypes.Name, user.Name), new("display", user.DisplayName), new(ClaimTypes.Role, user.Role)],
        CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(new ClaimsPrincipal(identity), new AuthenticationProperties { IsPersistent = req.Remember });
    audit.Write(ctx, "login", user: user.Name);
    return Results.Ok(Me(identity));
}).RequireRateLimiting("login");

api.MapGet("/login/options", (CertAuth certs) => Results.Ok(new { certificate = certs.Enabled }));

api.MapPost("/login/certificate", async (HttpContext ctx, CertAuth certs, UserStore users, AuditLog audit) =>
{
    if (!certs.Enabled) return Results.NotFound();
    var cert = await certs.GetCertificateAsync(ctx);
    if (cert is null) return Results.Json(new { error = "Your browser didn't send a certificate. Install your EUNET certificate and try again." }, statusCode: 401);
    var (name, error) = certs.Validate(cert);
    var user = name is null ? null : users.All().FirstOrDefault(u => string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase));
    if (user is null)
    {
        audit.Write(ctx, "login-failed", $"certificate {cert.Subject}: {error ?? "no matching user"}", user: name);
        return Results.Json(new { error = error ?? $"No portal account matches the certificate for “{name}”." }, statusCode: 401);
    }
    var identity = new ClaimsIdentity(
        [new(ClaimTypes.Name, user.Name), new("display", user.DisplayName), new(ClaimTypes.Role, user.Role), new("amr", "certificate")],
        CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(new ClaimsPrincipal(identity));
    audit.Write(ctx, "login", $"certificate {cert.GetCertHashString(System.Security.Cryptography.HashAlgorithmName.SHA256)[..16]}…", user: user.Name);
    return Results.Ok(Me(identity));
}).RequireRateLimiting("login");

api.MapPost("/logout", async (HttpContext ctx, AuditLog audit) =>
{
    audit.Write(ctx, "logout");
    await ctx.SignOutAsync();
    return Results.NoContent();
});

api.MapGet("/me", (ClaimsPrincipal u) => Results.Ok(Me(u.Identity!))).RequireAuthorization();

api.MapPost("/me/password", (PasswordChange req, ClaimsPrincipal u, UserStore users, AuditLog audit, HttpContext ctx) =>
{
    if (users.Verify(u.Identity!.Name!, req.Current ?? "") is null) return Results.Json(new { error = "Current password is wrong." }, statusCode: 400);
    if ((req.New ?? "").Length < 10) return Results.Json(new { error = "Use at least 10 characters." }, statusCode: 400);
    users.SetPassword(u.Identity.Name!, req.New!);
    audit.Write(ctx, "password-changed");
    return Results.NoContent();
}).RequireAuthorization();

// ---------- Documents ----------
var docs = api.MapGroup("/files").RequireAuthorization();

docs.MapGet("/", (string? path, FileStore store) =>
{
    try { return Results.Ok(store.List(path)); }
    catch (DirectoryNotFoundException) { return Results.NotFound(); }
});

docs.MapGet("/download", (string path, bool? inline, FileStore store) =>
{
    var full = store.Resolve(path);
    if (!File.Exists(full)) return Results.NotFound();
    new FileExtensionContentTypeProvider().TryGetContentType(full, out var type);
    // Only images and PDFs display in the browser; everything else downloads
    var show = inline == true && type is not null && (type.StartsWith("image/") && type != "image/svg+xml" || type == "application/pdf");
    return Results.File(full, type ?? "application/octet-stream", show ? null : Path.GetFileName(full), enableRangeProcessing: true);
});

docs.MapPost("/upload", async (HttpRequest req, string? path, FileStore store, AuditLog audit) =>
{
    if (!req.HasFormContentType) return Results.BadRequest();
    var form = await req.ReadFormAsync();
    var dir = store.Resolve(path);
    if (!Directory.Exists(dir)) return Results.NotFound();
    var saved = new List<string>();
    foreach (var file in form.Files)
    {
        var name = FileStore.CleanName(file.FileName);
        var target = Path.Combine(dir, name);
        // Keep both copies when a file with the same name exists
        for (var i = 2; File.Exists(target); i++)
            target = Path.Combine(dir, $"{Path.GetFileNameWithoutExtension(name)} ({i}){Path.GetExtension(name)}");
        await using var fs = File.Create(target);
        await file.CopyToAsync(fs);
        saved.Add(store.Relative(target));
        audit.Write(req.HttpContext, "upload", store.Relative(target));
    }
    return Results.Ok(saved);
}).DisableAntiforgery();

docs.MapPost("/folder", (NewFolder req, FileStore store, AuditLog audit, HttpContext ctx) =>
{
    var full = Path.Combine(store.Resolve(req.Path), FileStore.CleanName(req.Name));
    if (Directory.Exists(full) || File.Exists(full)) return Results.Conflict(new { error = "Something with that name already exists." });
    Directory.CreateDirectory(full);
    audit.Write(ctx, "folder-created", store.Relative(full));
    return Results.Ok(store.Relative(full));
});

docs.MapDelete("/", (string path, FileStore store, AuditLog audit, HttpContext ctx) =>
{
    var full = store.Resolve(path);
    if (full == store.Root) return Results.BadRequest();
    if (File.Exists(full)) File.Delete(full);
    else if (Directory.Exists(full))
    {
        if (Directory.EnumerateFileSystemEntries(full).Any()) return Results.Conflict(new { error = "Empty the folder first." });
        Directory.Delete(full);
    }
    else return Results.NotFound();
    audit.Write(ctx, "delete", path);
    return Results.NoContent();
});

// ---------- Certificate tracker: every certificate found in the library ----------
api.MapGet("/certs", (FileStore store) => Results.Ok(CertScanner.Scan(store))).RequireAuthorization();

// ---------- Cameras (configured in data/cameras.json) ----------
api.MapGet("/cameras", () =>
{
    var file = Path.Combine(dataDir, "cameras.json");
    return File.Exists(file) ? Results.Text(File.ReadAllText(file), "application/json") : Results.Ok(Array.Empty<object>());
}).RequireAuthorization();

// ---------- Status and admin ----------
api.MapGet("/status", (FileStore store, UserStore users) =>
{
    var (files, bytes) = store.Totals();
    var drive = new DriveInfo(store.Root);
    var proc = Process.GetCurrentProcess();
    return Results.Ok(new
    {
        server = Environment.MachineName,
        os = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        started,
        uptimeSeconds = (long)(DateTimeOffset.UtcNow - started).TotalSeconds,
        cpus = Environment.ProcessorCount,
        processMemoryMb = proc.WorkingSet64 / 1048576,
        disk = new { totalGb = drive.TotalSize / 1073741824.0, freeGb = drive.AvailableFreeSpace / 1073741824.0 },
        library = new { files, bytes },
        users = users.All().Count,
    });
}).RequireAuthorization();

api.MapGet("/audit", (AuditLog audit, int? take) => Results.Ok(audit.Tail(take ?? 50))).RequireAuthorization("admin");

// Daily counts for the last two weeks, for the dashboard charts
api.MapGet("/activity", (AuditLog audit) =>
{
    var days = Enumerable.Range(0, 14).Select(i => DateTime.UtcNow.Date.AddDays(i - 13)).ToList();
    var events = audit.Tail(500).Select(e => (Day: e.GetProperty("at").GetDateTimeOffset().UtcDateTime.Date, Action: e.GetProperty("action").GetString())).ToList();
    int[] Count(params string[] actions) => [.. days.Select(d => events.Count(e => e.Day == d && actions.Contains(e.Action)))];
    return Results.Ok(new
    {
        days = days.Select(d => d.ToString("yyyy-MM-dd")),
        signIns = Count("login"),
        failedSignIns = Count("login-failed"),
        uploads = Count("upload"),
    });
}).RequireAuthorization();

var admin = api.MapGroup("/users").RequireAuthorization("admin");
admin.MapGet("/", (UserStore users) => users.All().Select(u => new { u.Name, u.DisplayName, u.Role, u.Created }));
admin.MapPost("/", (NewUser req, UserStore users, AuditLog audit, HttpContext ctx) =>
{
    if (string.IsNullOrWhiteSpace(req.Name) || !System.Text.RegularExpressions.Regex.IsMatch(req.Name, "^[a-zA-Z0-9._-]{2,32}$"))
        return Results.Json(new { error = "User names use 2-32 letters, numbers, dots, dashes or underscores." }, statusCode: 400);
    if ((req.Password ?? "").Length < 10) return Results.Json(new { error = "Use at least 10 characters for the password." }, statusCode: 400);
    try
    {
        var u = users.Add(req.Name, string.IsNullOrWhiteSpace(req.DisplayName) ? req.Name : req.DisplayName.Trim(), req.Role == "admin" ? "admin" : "user", req.Password!);
        audit.Write(ctx, "user-added", u.Name);
        return Results.Ok(new { u.Name, u.DisplayName, u.Role, u.Created });
    }
    catch (InvalidOperationException e) { return Results.Json(new { error = e.Message }, statusCode: 409); }
});
admin.MapDelete("/{name}", (string name, ClaimsPrincipal me, UserStore users, AuditLog audit, HttpContext ctx) =>
{
    if (string.Equals(name, me.Identity!.Name, StringComparison.OrdinalIgnoreCase)) return Results.Json(new { error = "You can't remove your own account." }, statusCode: 400);
    if (!users.Remove(name)) return Results.NotFound();
    audit.Write(ctx, "user-removed", name);
    return Results.NoContent();
});

// ---------- Local AI assistant (Ollama on the same machine or network; nothing goes to the internet) ----------
var ai = api.MapGroup("/ai").RequireAuthorization();

ai.MapGet("/models", async (IHttpClientFactory http, IConfiguration cfg) =>
{
    try
    {
        using var doc = JsonDocument.Parse(await http.CreateClient("ollama").GetStringAsync("/api/tags"));
        var models = doc.RootElement.GetProperty("models").EnumerateArray().Select(m => m.GetProperty("name").GetString()).ToList();
        var preferred = cfg["Ollama:Model"];
        return Results.Ok(new { available = true, models, selected = models.Contains(preferred) ? preferred : models.FirstOrDefault() });
    }
    catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
    {
        return Results.Ok(new { available = false, models = Array.Empty<string>(), selected = (string?)null });
    }
});

ai.MapPost("/chat", async (ChatRequest req, IHttpClientFactory http, HttpContext ctx, AuditLog audit) =>
{
    if (string.IsNullOrWhiteSpace(req.Model) || req.Messages is not { Count: > 0 and <= 40 } || req.Messages.Any(m => m.Content.Length > 8000 || m.Role is not ("user" or "assistant")))
        return Results.Json(new { error = "That conversation is too long or malformed. Start a new chat." }, statusCode: 400);

    var messages = new List<object> { new { role = "system", content = "You are the assistant inside EUNET, a private company portal. Answer clearly and briefly. Use plain text with short paragraphs or simple lists." } };
    messages.AddRange(req.Messages.Select(m => new { role = m.Role, content = m.Content }));
    var body = JsonContent.Create(new { model = req.Model, messages, stream = true });
    using var upstream = new HttpRequestMessage(HttpMethod.Post, "/api/chat") { Content = body };
    HttpResponseMessage res;
    try { res = await http.CreateClient("ollama").SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted); }
    catch (HttpRequestException) { return Results.Json(new { error = "The local AI isn't running. Start Ollama and try again." }, statusCode: 503); }
    if (!res.IsSuccessStatusCode) return Results.Json(new { error = $"The local AI refused the request ({(int)res.StatusCode})." }, statusCode: 502);

    audit.Write(ctx, "ai-chat", req.Model);
    // Stream the model's words straight to the browser as they arrive
    ctx.Response.ContentType = "text/plain; charset=utf-8";
    ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()?.DisableBuffering();
    using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ctx.RequestAborted));
    while (await reader.ReadLineAsync(ctx.RequestAborted) is { } line)
    {
        if (line.Length == 0) continue;
        using var chunk = JsonDocument.Parse(line);
        if (chunk.RootElement.TryGetProperty("message", out var msg) && msg.TryGetProperty("content", out var text))
        {
            await ctx.Response.WriteAsync(text.GetString() ?? "", ctx.RequestAborted);
            await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
        }
    }
    res.Dispose();
    return Results.Empty;
});

app.Run();

static object Me(System.Security.Principal.IIdentity id)
{
    var c = (ClaimsIdentity)id;
    return new { name = c.Name, displayName = c.FindFirst("display")?.Value ?? c.Name, role = c.FindFirst(ClaimTypes.Role)?.Value };
}

record LoginRequest(string? Name, string? Password, bool Remember);
record PasswordChange(string? Current, string? New);
record NewFolder(string? Path, string Name);
record NewUser(string Name, string? DisplayName, string? Role, string? Password);
record ChatMessage(string Role, string Content);
record ChatRequest(string? Model, List<ChatMessage>? Messages);

/// <summary>Append-only JSON-lines audit trail of security-relevant actions.</summary>
class AuditLog(string path)
{
    private readonly Lock _lock = new();

    public void Write(HttpContext ctx, string action, string? detail = null, string? user = null)
    {
        var line = JsonSerializer.Serialize(new
        {
            at = DateTimeOffset.UtcNow,
            user = user ?? ctx.User.Identity?.Name,
            ip = ctx.Connection.RemoteIpAddress?.ToString(),
            action,
            detail,
        });
        lock (_lock) File.AppendAllText(path, line + "\n");
    }

    public IEnumerable<JsonElement> Tail(int take)
    {
        if (!File.Exists(path)) return [];
        string[] lines;
        lock (_lock) lines = File.ReadAllLines(path);
        return lines.TakeLast(Math.Clamp(take, 1, 500)).Reverse().Select(l => JsonDocument.Parse(l).RootElement.Clone());
    }
}
