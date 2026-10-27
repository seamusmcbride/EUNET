using System.Security.Cryptography.X509Certificates;

namespace Portal;

/// <summary>
/// Signs users in with a client certificate issued by a trusted CA. The certificate's common name (CN)
/// must match a portal user name. Enabled by setting ClientCertificates:TrustedCaFile to a PEM bundle.
/// </summary>
public class CertAuth
{
    private readonly X509Certificate2Collection _trusted = [];
    private readonly string? _forwardedHeader;
    private readonly bool _checkRevocation;

    public bool Enabled => _trusted.Count > 0;

    public CertAuth(IConfiguration cfg, ILogger<CertAuth> log)
    {
        var file = cfg["ClientCertificates:TrustedCaFile"];
        if (string.IsNullOrWhiteSpace(file)) return;
        _trusted.ImportFromPemFile(file);
        _checkRevocation = cfg.GetValue<bool>("ClientCertificates:CheckRevocation");
        // Only read a proxy's certificate header when the portal is configured to trust its proxy
        if (cfg.GetValue<bool>("TrustForwardedHeaders")) _forwardedHeader = cfg["ClientCertificates:ForwardedHeader"];
        log.LogInformation("Certificate sign-in enabled with {Count} trusted CA certificate(s)", _trusted.Count);
    }

    public async Task<X509Certificate2?> GetCertificateAsync(HttpContext ctx)
    {
        if (!string.IsNullOrEmpty(_forwardedHeader) && ctx.Request.Headers[_forwardedHeader].FirstOrDefault() is { Length: > 0 } header)
        {
            // nginx's $ssl_client_escaped_cert and Caddy's placeholder both send URL-encoded PEM
            try { return X509Certificate2.CreateFromPem(Uri.UnescapeDataString(header)); }
            catch (Exception e) when (e is System.Security.Cryptography.CryptographicException or ArgumentException) { return null; }
        }
        return await ctx.Connection.GetClientCertificateAsync();
    }

    /// <summary>Returns the user name the certificate vouches for, or an error explaining why it was refused.</summary>
    public (string? User, string? Error) Validate(X509Certificate2 cert)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        foreach (var root in _trusted.Where(c => c.SubjectName.RawData.AsSpan().SequenceEqual(c.IssuerName.RawData)))
            chain.ChainPolicy.CustomTrustStore.Add(root);
        chain.ChainPolicy.ExtraStore.AddRange(_trusted); // intermediates
        chain.ChainPolicy.RevocationMode = _checkRevocation ? X509RevocationMode.Online : X509RevocationMode.NoCheck;
        chain.ChainPolicy.ApplicationPolicy.Add(new("1.3.6.1.5.5.7.3.2")); // TLS client authentication
        if (!chain.Build(cert))
            return (null, "Certificate isn't trusted: " + string.Join(", ", chain.ChainStatus.Select(s => s.StatusInformation.Trim()).Where(s => s.Length > 0).Distinct()));
        var name = cert.GetNameInfo(X509NameType.SimpleName, false);
        return string.IsNullOrWhiteSpace(name) ? (null, "Certificate has no common name.") : (name, null);
    }
}
