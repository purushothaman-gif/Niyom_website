# Deploying the NIYOM BSE Proxy on the DigitalOcean droplet

The droplet's **static IP is the whole point** — it's what BSE whitelists for
API access. One-time setup below assumes a fresh Ubuntu 22.04/24.04 droplet.

## 0. Send BSE the droplet IP

Get it from the DigitalOcean dashboard (or `curl -4 ifconfig.me` on the box) and
share it with BSE for **both** demo and production whitelisting.

## 1. Base setup (as root, once)

```bash
adduser --disabled-password --gecos "" niyom
usermod -aG sudo niyom
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
```

## 2. Get the code onto the box

```bash
su - niyom
git clone https://github.com/KavitaSri06/Niyom.git
cd Niyom/server/bse-proxy
npm ci
npm run build
cp .env.example .env && nano .env   # fill BSE + Supabase values
```

## 3. Run it as a service

`sudo nano /etc/systemd/system/bse-proxy.service`:

```ini
[Unit]
Description=NIYOM BSE Proxy
After=network.target

[Service]
User=niyom
WorkingDirectory=/home/niyom/Niyom/server/bse-proxy
EnvironmentFile=/home/niyom/Niyom/server/bse-proxy/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bse-proxy
curl -s localhost:8080/health   # → {"ok":true,...}
```

## 4. HTTPS in front (nginx + certbot)

Point a DNS A-record (e.g. `api.niyomwealth.com`) at the droplet IP, then:

```bash
sudo tee /etc/nginx/sites-available/bse-proxy <<'NGINX'
server {
    server_name api.niyomwealth.com;

    # Required. UCC registration carries the cancelled cheque and AOF inline as
    # base64, and Express accepts 10mb. Without this nginx applies its own 1m
    # default and returns 413 before the request ever reaches the app.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX
sudo ln -s /etc/nginx/sites-available/bse-proxy /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.niyomwealth.com
```

## 5. Point the app at it

In the web app's environment (Vercel → Project → Environment Variables):

```
VITE_BSE_MODE=live
VITE_BSE_PROXY_URL=https://api.niyomwealth.com
```

Redeploy the app — `BSEService` flips from mock to live with no code changes.

## 6. Updating

```bash
cd ~/Niyom && git pull
cd server/bse-proxy && npm ci && npm run build
sudo systemctl restart bse-proxy
```

## Notes

- The proxy refuses to start without BSE credentials (env validation).
- Every request (except `/health`) requires a valid Supabase session JWT.
- Start with `BSE_ENV=demo`; flip to `prod` only after UAT sign-off.
- All fields marked `UAT-VERIFY` in `src/mappers.ts` must be confirmed against
  the sandbox before production go-live.
