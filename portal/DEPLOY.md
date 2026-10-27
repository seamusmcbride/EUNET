# Deploying the EUNET Portal

The portal ships as one container image (`portal/Dockerfile`), built from the repository root. It stores everything in `/data`: users, documents and the audit log. **Give it persistent storage and run exactly one copy**, because the data lives in files rather than a database.

## On your laptop (with the local AI)

Everything runs on your machine, including the AI model. Nothing is sent to the internet, and the portal is only reachable from the laptop itself.

1. Install **Docker Desktop** (Windows or Mac) or Docker Engine (Linux).
2. Get the code and start it:

```bash
git clone https://github.com/seamusmcbride/eunet.git
cd eunet
git checkout claude/laughing-knuth-u79qpb
docker compose up -d --build
```

3. Open http://localhost:8080 and sign in as `admin` with the password `change-me-please`, then change it under **My account**. To choose the password up front, set `EUNET_ADMIN_PASSWORD` before step 2.

The first start downloads the AI model, about 2 GB, so the **Assistant** page shows the AI as unavailable for a few minutes.

Choosing a model: set `EUNET_AI_MODEL` before starting.

| Laptop | Suggested model | Notes |
|---|---|---|
| 8 GB RAM, no GPU | `qwen2.5:3b` (default) | Usable, a few words a second |
| 16 GB RAM | `qwen2.5:7b` or `llama3.1:8b` | Noticeably better answers |
| NVIDIA GPU | `qwen2.5:14b` | Uncomment the GPU section in `docker-compose.yml` |

Very small models such as `qwen2.5:0.5b` are fast but often wrong on technical detail, so don't rely on them for PKI facts.

**Already running Ollama on the laptop?** Skip the bundled one: run the portal with `dotnet run` from `portal/` and it finds Ollama at `http://localhost:11434`. Set `Ollama__Model` to pick the model.

---

## On a server

Pick one of the three options below. Each ends with the portal on HTTPS. Set the first admin password with `EUNET_ADMIN_PASSWORD`, then change it after signing in.

---

## Option 1: A plain VM (Azure, Google, Hetzner, any provider)

The cheapest and simplest option. A 2 vCPU / 4 GB Ubuntu VM is plenty. Point a DNS name, for example `portal.example.com`, at the VM's public IP first.

```bash
# On the VM
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
git clone https://github.com/seamusmcbride/eunet.git && cd eunet
git checkout claude/laughing-knuth-u79qpb
sudo docker build -f portal/Dockerfile -t eunet-portal .
```

Create `docker-compose.yml` next to the repository. Caddy gets and renews the HTTPS certificate automatically:

```yaml
services:
  portal:
    image: eunet-portal
    restart: unless-stopped
    environment:
      EUNET_ADMIN_PASSWORD: "change-me-to-something-long"
    volumes:
      - eunet-data:/data
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from portal.example.com --to portal:8080
    volumes:
      - caddy-data:/data
volumes:
  eunet-data:
  caddy-data:
```

```bash
sudo docker compose up -d
```

Open only ports 80 and 443 in the VM's firewall. Port 8080 stays private, which is what makes trusting the proxy's headers safe. Back up the `eunet-data` volume.

---

## Option 2: Google Cloud Run

Cloud Run gives HTTPS and a `*.run.app` address automatically. Its disk is temporary, so `/data` is mounted from a Cloud Storage bucket.

```bash
PROJECT=your-project-id REGION=europe-west1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create eunet --repository-format=docker --location=$REGION
gcloud storage buckets create gs://$PROJECT-eunet-data --location=$REGION

# Build in Google Cloud (uses portal/cloudbuild.yaml)
gcloud builds submit --config portal/cloudbuild.yaml --substitutions=_IMAGE=$REGION-docker.pkg.dev/$PROJECT/eunet/portal .

gcloud run deploy eunet-portal \
  --image=$REGION-docker.pkg.dev/$PROJECT/eunet/portal --region=$REGION \
  --allow-unauthenticated --port=8080 --min-instances=0 --max-instances=1 \
  --set-env-vars=EUNET_ADMIN_PASSWORD=change-me-to-something-long \
  --add-volume=name=data,type=cloud-storage,bucket=$PROJECT-eunet-data \
  --add-volume-mount=volume=data,mount-path=/data
```

`--max-instances=1` matters: two copies writing the same files would conflict. For production, put the admin password in Secret Manager instead of an environment variable.

---

## Option 3: Azure Container Apps

```bash
RG=eunet-rg LOC=westeurope ACR=eunetregistry$RANDOM
az group create -n $RG -l $LOC
az acr create -g $RG -n $ACR --sku Basic --admin-enabled true
az acr build -r $ACR -t eunet-portal:latest -f portal/Dockerfile .

az containerapp env create -g $RG -n eunet-env -l $LOC
az containerapp create -g $RG -n eunet-portal --environment eunet-env \
  --image $ACR.azurecr.io/eunet-portal:latest --registry-server $ACR.azurecr.io \
  --target-port 8080 --ingress external --min-replicas 1 --max-replicas 1 \
  --env-vars EUNET_ADMIN_PASSWORD=change-me-to-something-long
```

That gives an HTTPS address ending in `azurecontainerapps.io`. Container Apps storage is temporary by default. Before uploading anything you want to keep, create an Azure Files share, add it to the environment with `az containerapp env storage set`, and mount it at `/data`. Microsoft's guide "Use storage mounts in Azure Container Apps" has the steps. Keep the app at one replica.

---

## After deploying

1. Sign in as `admin` with the password you set, then change it under **My account**.
2. Add your users under **Users & audit**.
3. To add cameras, put `cameras.json` in `/data` (see README.md).
