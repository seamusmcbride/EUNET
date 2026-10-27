using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;

namespace Portal;

public record PortalUser(string Name, string DisplayName, string Role, string PasswordHash, DateTimeOffset Created);

/// <summary>Users kept in a JSON file. Passwords use ASP.NET Core Identity's PBKDF2 hasher.</summary>
public class UserStore
{
    private readonly string _path;
    private readonly PasswordHasher<string> _hasher = new();
    private readonly Lock _lock = new();
    private Dictionary<string, PortalUser> _users;

    public UserStore(string dataDir, ILogger<UserStore> log)
    {
        _path = Path.Combine(dataDir, "users.json");
        _users = File.Exists(_path)
            ? JsonSerializer.Deserialize<List<PortalUser>>(File.ReadAllText(_path))!.ToDictionary(u => u.Name, StringComparer.OrdinalIgnoreCase)
            : new(StringComparer.OrdinalIgnoreCase);

        if (_users.Count == 0)
        {
            // First run: create the admin account from EUNET_ADMIN_PASSWORD, or generate one and print it once
            var password = Environment.GetEnvironmentVariable("EUNET_ADMIN_PASSWORD");
            if (string.IsNullOrWhiteSpace(password))
            {
                password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(12)).TrimEnd('=').Replace('+', 'x').Replace('/', 'y');
                log.LogWarning("Created user 'admin' with generated password: {Password}  (change it after signing in)", password);
            }
            Add("admin", "Administrator", "admin", password);
        }
    }

    public IReadOnlyList<PortalUser> All() { lock (_lock) return [.. _users.Values.OrderBy(u => u.Name)]; }

    public PortalUser? Verify(string name, string password)
    {
        PortalUser? user;
        lock (_lock) _users.TryGetValue(name, out user);
        if (user is null)
        {
            // Hash anyway so a missing user takes as long as a wrong password
            _hasher.HashPassword(name, password);
            return null;
        }
        return _hasher.VerifyHashedPassword(user.Name, user.PasswordHash, password) == PasswordVerificationResult.Failed ? null : user;
    }

    public PortalUser Add(string name, string displayName, string role, string password)
    {
        var user = new PortalUser(name, displayName, role, _hasher.HashPassword(name, password), DateTimeOffset.UtcNow);
        lock (_lock)
        {
            if (!_users.TryAdd(name, user)) throw new InvalidOperationException("That user name is taken.");
            Save();
        }
        return user;
    }

    public void SetPassword(string name, string password)
    {
        lock (_lock)
        {
            var u = _users[name];
            _users[name] = u with { PasswordHash = _hasher.HashPassword(name, password) };
            Save();
        }
    }

    public bool Remove(string name)
    {
        lock (_lock)
        {
            var removed = _users.Remove(name);
            if (removed) Save();
            return removed;
        }
    }

    private void Save()
    {
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_users.Values, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, _path, overwrite: true);
    }
}
