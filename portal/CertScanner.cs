using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Portal;

public record CertInfo(
    string Path, int Index, string Subject, string CommonName, string Issuer, DateTime NotBefore, DateTime NotAfter, int DaysLeft,
    string KeyAlgorithm, int KeySize, string SignatureAlgorithm, bool IsCa, bool SelfSigned, string[] Names, string Sha256, string Serial,
    string Status, string[] Warnings)
{
    public string[] FoundIn { get; init; } = [Path];
}

/// <summary>Finds certificates in the document library and checks their expiry and strength.</summary>
public static class CertScanner
{
    static readonly string[] Extensions = [".crt", ".cer", ".pem", ".der", ".p7b", ".p7c"];
    const int ExpiringSoonDays = 30;

    public static List<CertInfo> Scan(FileStore store)
    {
        var results = new List<CertInfo>();
        foreach (var file in Directory.EnumerateFiles(store.Root, "*", SearchOption.AllDirectories))
        {
            if (!Extensions.Contains(Path.GetExtension(file).ToLowerInvariant()) || new FileInfo(file).Length > 1_000_000) continue;
            var rel = store.Relative(file);
            var certs = Load(file);
            for (var i = 0; i < certs.Count; i++) results.Add(Describe(certs[i], rel, i));
        }
        // The same certificate often sits in several files (a CA in every chain); list it once with all its locations
        return [.. results.GroupBy(c => c.Sha256)
            .Select(g => g.First() with { FoundIn = [.. g.Select(c => c.Path).Distinct()] })
            .OrderBy(c => c.NotAfter)];
    }

    static X509Certificate2Collection Load(string file)
    {
        var col = new X509Certificate2Collection();
        try
        {
            var text = File.ReadAllText(file);
            if (text.Contains("-----BEGIN CERTIFICATE-----")) col.ImportFromPem(text); // PEM, possibly a whole chain
            else if (file.EndsWith(".p7b", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".p7c", StringComparison.OrdinalIgnoreCase))
            {
                // PKCS#7 bundles come either as raw DER or wrapped in "-----BEGIN PKCS7-----" text
                var pem = PemEncoding.TryFind(text, out var fields) ? Convert.FromBase64String(text[fields.Base64Data]) : File.ReadAllBytes(file);
                var cms = new System.Security.Cryptography.Pkcs.SignedCms();
                cms.Decode(pem);
                col.AddRange(cms.Certificates);
            }
            else col.Add(X509CertificateLoader.LoadCertificate(File.ReadAllBytes(file))); // DER
        }
        catch (CryptographicException) { /* not a certificate, or damaged; skip it */ }
        return col;
    }

    static CertInfo Describe(X509Certificate2 c, string path, int index)
    {
        var (alg, size) = KeyInfo(c);
        var sig = c.SignatureAlgorithm.FriendlyName ?? c.SignatureAlgorithm.Value ?? "unknown";
        var basic = c.Extensions.OfType<X509BasicConstraintsExtension>().FirstOrDefault();
        var names = c.Extensions.OfType<X509SubjectAlternativeNameExtension>().FirstOrDefault() is { } san
            ? [.. san.EnumerateDnsNames(), .. san.EnumerateIPAddresses().Select(ip => ip.ToString())]
            : Array.Empty<string>();
        var daysLeft = (int)Math.Floor((c.NotAfter.ToUniversalTime() - DateTime.UtcNow).TotalDays);

        var warnings = new List<string>();
        if (daysLeft < 0) warnings.Add("Expired");
        else if (daysLeft <= ExpiringSoonDays) warnings.Add($"Expires in {daysLeft} days");
        if (c.NotBefore.ToUniversalTime() > DateTime.UtcNow) warnings.Add("Not valid yet");
        if (alg == "RSA" && size < 2048) warnings.Add($"Weak key: RSA {size}");
        if (alg == "ECDSA" && size < 256) warnings.Add($"Weak key: ECDSA {size}");
        if (sig.Contains("sha1", StringComparison.OrdinalIgnoreCase) || sig.Contains("md5", StringComparison.OrdinalIgnoreCase)) warnings.Add($"Weak signature: {sig}");
        if (basic?.CertificateAuthority != true && names.Length == 0) warnings.Add("No subject alternative names");
        var lifetime = (c.NotAfter - c.NotBefore).TotalDays;
        if (basic?.CertificateAuthority != true && lifetime > 398) warnings.Add($"Lifetime {lifetime:0} days exceeds the 398-day browser limit");

        var status = daysLeft < 0 || c.NotBefore.ToUniversalTime() > DateTime.UtcNow ? "invalid"
            : warnings.Count == 0 ? "ok"
            : warnings.Any(w => w.StartsWith("Weak") || w.StartsWith("Expires")) ? "warning" : "notice";

        return new CertInfo(path, index, c.Subject, c.GetNameInfo(X509NameType.SimpleName, false), c.Issuer,
            c.NotBefore.ToUniversalTime(), c.NotAfter.ToUniversalTime(), daysLeft, alg, size, sig,
            basic?.CertificateAuthority == true, c.SubjectName.RawData.AsSpan().SequenceEqual(c.IssuerName.RawData),
            names, c.GetCertHashString(HashAlgorithmName.SHA256), c.SerialNumber, status, [.. warnings]);
    }

    static (string, int) KeyInfo(X509Certificate2 c)
    {
        using (var rsa = c.GetRSAPublicKey()) if (rsa is not null) return ("RSA", rsa.KeySize);
        using (var ec = c.GetECDsaPublicKey()) if (ec is not null) return ("ECDSA", ec.KeySize);
        return (c.PublicKey.Oid.FriendlyName ?? "Other", 0);
    }
}
