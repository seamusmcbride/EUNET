# Installing EUNET on a VM

This release is pre-built, so the server doesn't need to compile anything. It runs on x64 and ARM64 Linux.

## 1. Get a free VM

| Provider | Free VM | Good for |
|---|---|---|
| **Oracle Cloud** (Always Free) | Ampere A1 ARM, up to 4 cores and 24 GB RAM | Everything, **including the local AI**. Best free option. |
| Google Cloud (Free Tier) | e2-micro, 2 shared cores, 1 GB RAM, US regions only | Portal only. Too small for the AI. |
| AWS (Free Tier, 12 months) | t3.micro / t2.micro, 1 GB RAM | Portal only. |
| Azure (Free account, 12 months) | B1s, 1 GB RAM | Portal only. |

Free-tier terms change, so check the provider's current page before you sign up. Choose **Ubuntu 24.04** as the image. Give it at least 20 GB of disk, or 40 GB if you want the AI.

In the provider's network settings, open **TCP ports 80 and 443** to the internet, and keep 22 (SSH) open. Oracle Cloud also needs these ports allowed in the VCN security list.

For a 1 GB VM, add swap first so updates don't run out of memory:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Copy the release and install

From your computer:

```bash
scp eunet-*.tar.gz ubuntu@YOUR_VM_IP:~
ssh ubuntu@YOUR_VM_IP
```

On the VM:

```bash
tar xzf eunet-*.tar.gz && cd eunet-*/
sudo ./install.sh                                   # HTTPS on the VM's IP address (browser shows a warning)
sudo ./install.sh --domain portal.example.com       # real certificate from Let's Encrypt (point the DNS at the VM first)
sudo ./install.sh --domain portal.example.com --with-ai --model qwen2.5:3b   # plus the local AI (Oracle ARM VM)
```

At the end the installer prints the address and the **admin password**. It's shown only once, so change it under **My account** after signing in.

The installer sets up:
- the ASP.NET Core 10 runtime, from Ubuntu's own repositories
- the portal as a locked-down `eunet` system service with a read-only filesystem and no privileges
- Caddy for HTTPS, with automatic Let's Encrypt certificates when you give a domain
- the firewall (ufw), allowing only SSH, HTTP and HTTPS
- daily backups to `/var/backups/eunet` (14 kept)
- optionally, Ollama with the AI model you choose

## 3. Day to day

| Task | Command |
|---|---|
| See the log | `journalctl -u eunet -f` |
| Restart | `sudo systemctl restart eunet` |
| Back up now | `sudo eunet-backup` |
| Change settings | edit `/etc/eunet/eunet.env`, then restart |
| Upgrade | unpack a newer release and run `sudo ./install.sh` again (data is kept) |
| Restore a backup | `sudo systemctl stop eunet && sudo tar xzf /var/backups/eunet/eunet-DATE.tar.gz -C / && sudo systemctl start eunet` |

Copy backups off the VM regularly, for example with `scp` to your laptop. A backup that lives only on the VM won't survive losing the VM.

To turn on certificate sign-in, see **PORTAL.md** ("Certificate sign-in").
