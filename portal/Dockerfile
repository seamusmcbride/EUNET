# EUNET Portal container. Build from the repository root:
#   docker build -f portal/Dockerfile -t eunet-portal .
# Runs on Google Cloud Run, Azure Container Apps / App Service, or any VM with Docker.

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY showcase/package.json showcase/package-lock.json showcase/
RUN cd showcase && npm ci
COPY showcase/ showcase/
RUN cd showcase && npx vite build
COPY portal/package.json portal/package-lock.json portal/
RUN cd portal && npm ci
COPY portal/scripts/ portal/scripts/
RUN cd portal && npm run vendor

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src/portal
COPY portal/Portal.csproj .
RUN dotnet restore
COPY portal/ .
COPY --from=web /src/portal/wwwroot/lib wwwroot/lib
COPY --from=web /src/showcase/dist wwwroot/showcase
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# Cloud Run and Container Apps pass PORT; default to 8080
# Cloud hosts terminate HTTPS in front of the container. Set TrustForwardedHeaders=false if you expose port 8080 directly.
ENV ASPNETCORE_HTTP_PORTS=8080 DataDir=/data TrustForwardedHeaders=true
# The app runs as the non-root "app" user, so it must own the data folder
RUN mkdir -p /data && chown app:app /data
VOLUME /data
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Portal.dll"]
