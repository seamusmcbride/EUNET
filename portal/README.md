# EUNET Portal

Sign-in, documents library, a private AI assistant, cameras, photo editor, status dashboard, user admin and the EUNET games, in one ASP.NET Core (.NET 10) app.

To run it on a laptop with the local AI, or to put it on a server, see **DEPLOY.md**.

## Run it locally

```bash
EUNET_ADMIN_PASSWORD='choose-a-long-password' dotnet run
```

Open http://localhost:5000 and sign in as `admin`. If you don't set `EUNET_ADMIN_PASSWORD` on first run, a random password is generated and printed once in the log. Change it under **My account**.

To include the games and showcase, build them into `wwwroot/showcase` first (the publish script does this for you).

## Publish for the server

```powershell
pwsh ./publish.ps1            # builds the showcase and publishes to ./out
```

Copy `out/` to the server (for example `/opt/eunet`) and run it as a service:

```ini
# /etc/systemd/system/eunet.service
[Unit]
Description=EUNET Portal
After=network.target

[Service]
WorkingDirectory=/opt/eunet
ExecStart=/usr/bin/dotnet /opt/eunet/Portal.dll
Environment=ASPNETCORE_URLS=http://127.0.0.1:5000
Environment=DataDir=/var/lib/eunet
User=eunet
Restart=always

[Install]
WantedBy=multi-user.target
```

Put nginx (or Caddy) in front for HTTPS. Over HTTPS the sign-in cookie is sent only on secure connections.

```nginx
server {
    listen 443 ssl http2;
    server_name portal.example.com;
    ssl_certificate     /etc/letsencrypt/live/portal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.example.com/privkey.pem;
    client_max_body_size 100m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Behind a proxy, the rate limiter and audit log see the proxy's address. Before going live, enable `UseForwardedHeaders` with the proxy's IP listed in `KnownProxies`, so they see the real client.

## Where data lives

Everything is under `DataDir` (default `./data`). Back up this folder.

| Path | Contents |
|---|---|
| `users.json` | Accounts. Passwords are PBKDF2 hashes (ASP.NET Core Identity hasher). |
| `files/` | The documents library. |
| `audit.log` | One JSON line per sign-in, upload, delete and admin change. |
| `cameras.json` | Camera list (see below). |

## Certificates

The **Certificates** page lists every certificate found in the documents library: `.crt`, `.cer`, `.pem` (including whole chains), `.der` and `.p7b`. Each certificate is listed once, with every file it appears in. It flags:

- expired or not-yet-valid certificates
- certificates expiring within 30 days
- RSA keys under 2048 bits, ECDSA under 256, and SHA-1 or MD5 signatures
- server certificates with no subject alternative names, or a lifetime over 398 days

## Certificate sign-in

Users can sign in with a client certificate from your own CA instead of a password. The certificate must:
- chain to a CA in `TrustedCaFile`
- carry the TLS client authentication purpose (`clientAuth`)
- have a common name (CN) matching a portal user name

Password sign-in keeps working alongside it.

| Setting | Meaning |
|---|---|
| `ClientCertificates:TrustedCaFile` | PEM file with your root CA and any intermediates that issue user certificates. Setting it turns the feature on. |
| `ClientCertificates:CheckRevocation` | `true` to check CRLs and OCSP online (off by default). |
| `ClientCertificates:ForwardedHeader` | Header your reverse proxy puts the client certificate in, e.g. `X-Client-Cert`. Only read when `TrustForwardedHeaders` is on. |

**Portal serving HTTPS itself (Kestrel):**

```bash
ASPNETCORE_URLS=https://0.0.0.0:443 \
Kestrel__Certificates__Default__Path=/etc/eunet/server.pfx Kestrel__Certificates__Default__Password=... \
ClientCertificates__TrustedCaFile=/etc/eunet/user-ca-chain.pem dotnet Portal.dll
```

**Behind nginx:** nginx checks the TLS handshake and passes the certificate on. `proxy_set_header` replaces any header a client tries to send itself.

```nginx
ssl_client_certificate /etc/nginx/eunet-user-ca.pem;
ssl_verify_client optional;
location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header X-Client-Cert $ssl_client_escaped_cert;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then run the portal with `TrustForwardedHeaders=true` and `ClientCertificates__ForwardedHeader=X-Client-Cert`. Never expose the portal's own port when you do this, or anyone could send a forged header.

Issuing a user certificate with OpenSSL (CN = the user name):

```bash
openssl req -newkey rsa:2048 -nodes -keyout jane.key -out jane.csr -subj "/CN=jane.doe"
openssl x509 -req -in jane.csr -CA issuing.crt -CAkey issuing.key -days 365 -out jane.crt \
  -extfile <(printf "basicConstraints=CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth")
openssl pkcs12 -export -in jane.crt -inkey jane.key -out jane.p12   # import this on the user's device
```

## AI assistant

The **Assistant** page talks to [Ollama](https://ollama.com) through the portal's server, so the browser never contacts an AI service directly and conversations stay on your machine. Settings in `appsettings.json` or environment variables:

| Setting | Default |
|---|---|
| `Ollama:Url` (`Ollama__Url`) | `http://localhost:11434` |
| `Ollama:Model` (`Ollama__Model`) | `qwen2.5:3b` |

Any model you've pulled with `ollama pull` appears in the model picker. The audit log records that someone used the assistant and which model they used, but not what was asked.

## Cameras

`data/cameras.json`:

```json
[
  { "name": "Front door", "type": "mjpeg", "url": "https://cams.example.com/front/stream.mjpeg" },
  { "name": "Yard", "type": "snapshot", "url": "https://cams.example.com/yard/snapshot.jpg" },
  { "name": "Garage", "type": "video", "url": "https://cams.example.com/garage.mp4" }
]
```

- `mjpeg`: a live MJPEG stream.
- `snapshot`: a JPEG refreshed every 2 seconds.
- `video`: anything a browser `<video>` element plays.

Camera URLs must be HTTPS, because the page's security policy blocks plain HTTP. Most IP cameras only speak RTSP. Run a relay such as [go2rtc](https://github.com/AlexxIT/go2rtc) on the server and point the portal at its MJPEG or snapshot URLs through the same HTTPS proxy.

## Security in place

- Cookie sign-in: HttpOnly, SameSite=Strict, 8-hour sliding expiry.
- 5 sign-in attempts per minute per address. Failed attempts take as long as wrong passwords for unknown users.
- Every state-changing API call needs an `X-EUNET` header, which blocks cross-site form posts.
- File paths are resolved inside the library root, so `../` is rejected. Upload names are cleaned.
- A Content-Security-Policy allows scripts only from the site itself, and `frame-ancestors 'none'` stops clickjacking.
- Only images and PDFs open in the browser. Other files download, so an uploaded HTML file can't run as part of the site.
- Admin-only user management and audit log.

- Optional certificate sign-in: chain validation against your own CA, the client-auth purpose required, and CN mapped to a user.

Not yet done: two-factor sign-in for password users, per-folder permissions, and virus scanning of uploads.
