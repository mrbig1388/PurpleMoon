# PurpleMoon Docker 安全部署指南（Caddy + Redis）

适用版本：PurpleMoon 2.8.9。写给**第一次自己部署网站的人**：从一台全新的 Linux 服务器开始，一步一步做到「别人在浏览器输入你的域名就能打开本站」，并且做到下面这些安全要求：

- 只有 Caddy 对公网开放 80/443，本站程序和数据库**不对公网开放**。
- 数据库放在**不能出网的内部网络**，并设置了密码。
- 所有容器**最小权限、限制资源、限制日志大小**。
- 全站自动 HTTPS，带安全响应头。
- 可选：用宿主机防火墙禁止本站容器访问内网和云元数据地址（防止被当作跳板）。

每一步都写了**要做什么、为什么、命令、应该看到什么、出错怎么办**，照着复制粘贴即可。

> **适用范围与已验证程度（请先读）**
> - 本指南的 `docker-compose.yml` 语法用 `docker compose config` 检查过；本站程序本身在 Docker 风格的构建下测试过。
> - 作者**没有在每一种 Linux 发行版和云服务商上逐条实机验证**本文的所有命令。第 9 步给出了「部署后验证清单」，请务必逐项做完。
> - 本站不提供公开的预构建镜像，下面的流程是**在你自己的服务器上用源码构建镜像**，第一次需要等几分钟。

---

## 目录

0. [先看懂：我们要搭出什么样子](#0-先看懂我们要搭出什么样子)
1. [准备服务器并做基础加固](#1-准备服务器并做基础加固)
2. [安装 Docker 和 Docker Compose](#2-安装-docker-和-docker-compose)
3. [把项目文件放到服务器上](#3-把项目文件放到服务器上)
4. [（内存不足 2GB 时）添加虚拟内存](#4-内存不足-2gb-时添加虚拟内存)
5. [设置域名解析并放行端口](#5-设置域名解析并放行端口)
6. [创建配置文件 `.env`](#6-创建配置文件-env)
7. [创建 `docker-compose.yml` 和 `Caddyfile`](#7-创建-docker-composeyml-和-caddyfile)
8. [检查配置、构建并启动](#8-检查配置构建并启动)
9. [部署后验证清单](#9-部署后验证清单)
10. [第一次登录与基本设置](#10-第一次登录与基本设置)
11. [可选加固：出口防火墙](#11-可选加固出口防火墙)
12. [日常运维、升级、备份与恢复](#12-日常运维升级备份与恢复)
13. [从旧的 README 部署方式迁移](#13-从旧的-readme-部署方式迁移)
14. [常见问题排查](#14-常见问题排查)
15. [安全检查清单](#15-安全检查清单)

---

## 0. 先看懂：我们要搭出什么样子

```
 访问者的浏览器
      │  https://movie.example.com      （你的域名）
      ▼
 ┌──────────────────────────── 你的服务器 ─────────────────────────────┐
 │  Caddy 容器          监听 80 / 443，自动申请并续期 HTTPS 证书        │
 │      │  frontend 网络                                               │
 │      ▼                                                              │
 │  purplemoon 容器     本站程序，监听 3000（不对公网开放，可访问外网）  │
 │      │  backend 内部网络（不能出网）                                │
 │      ▼                                                              │
 │  purplemoon-redis    保存用户、收藏、播放记录（不对公网开放、不能出网）│
 └─────────────────────────────────────────────────────────────────────┘
```

为什么这样分：

- **Caddy 是唯一对公网开放的入口**，它还会自动申请 HTTPS 证书。
- 本站程序需要**访问外网**（去各个资源站取数据），所以放在 `frontend` 网络。
- 数据库放在 `backend` 内部网络，**它连不了外网，Caddy 也碰不到它**；只有本站程序能访问。

**术语速查**

| 词 | 白话解释 |
| -- | -------- |
| 镜像（image） | 打包好的程序安装包 |
| 容器（container） | 镜像运行起来的实例，相当于一个独立的小系统 |
| Docker Compose | 用一个 `docker-compose.yml` 文件同时管理多个容器 |
| 反向代理 | 站在最前面接收访问、再转交给后面程序的"门卫" |
| `.env` 文件 | 存放密码、域名等配置的文本文件，**不要泄露、不要上传到公开仓库** |
| A 记录 | 域名解析里"域名 → 服务器 IP"的那一条 |

**开始之前，你需要有：**

| 准备项 | 要求 |
| ------ | ---- |
| 一台 Linux 服务器 | Ubuntu 22.04 / 24.04 或 Debian 12 最省事；建议 **1 核 2GB 内存**以上；有公网 IPv4 |
| 一个域名 | 已购买，且你能进入它的 DNS 解析管理页面 |
| 你的电脑能 SSH 登录服务器 | Windows 10/11 自带的 PowerShell、macOS/Linux 的终端都可以 |
| 本项目的压缩包或仓库地址 | 例如 `PurpleMoon-2.8.9.zip` |

> 💡 **在国内服务器上用域名对外提供网站，域名通常需要先完成 ICP 备案**，否则 80/443 端口可能被服务商拦截。没有备案时可使用境外服务器。

---

## 1. 准备服务器并做基础加固

> 如果你已经有一个配置好的服务器（非 root 用户、SSH 密钥登录、防火墙已开），可以跳到第 2 步。

### 1.1 更新系统

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 1.2 不要长期用 root 登录：创建一个普通管理用户

下面以用户名 `deploy` 为例（可以换成别的）。

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
```

按提示设置密码，其他信息直接回车。

### 1.3 配置 SSH 密钥登录（比密码安全得多）

在**你自己的电脑**上（不是服务器）：

```bash
# 如果你还没有密钥，先生成一个（一路回车即可）
ssh-keygen -t ed25519
# 把公钥传到服务器（把 服务器IP 换成你的）
ssh-copy-id deploy@服务器IP
```

然后**另开一个终端窗口**，确认能用密钥登录：

```bash
ssh deploy@服务器IP
```

> ⚠️ **一定要先确认密钥登录成功，再做下面的"禁用密码登录"**，否则你会把自己锁在服务器外面。

确认成功后，在服务器上禁用 SSH 密码登录和 root 登录：

```bash
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl restart ssh || sudo systemctl restart sshd
```

**再开一个新终端**确认仍能用密钥登录，再关闭旧窗口。

### 1.4 开启自动安全更新

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

出现提示选 `Yes`。

### 1.5 配置服务器防火墙（只放行 SSH、80、443）

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

> ⚠️ 如果你的 SSH 不是默认的 22 端口，把第一条 `22/tcp` 改成你的 SSH 端口，**否则启用防火墙会把你锁在外面**。
>
> 💡 **Docker 发布的端口会绕过 `ufw`**（Docker 直接写 iptables 规则）。所以本指南**只对外发布 80 和 443**，其他端口（3000、6379）一概不发布。不要自己随手给容器加 `ports:`。

**应该看到** `Status: active`，列表里有 22、80、443。

---

## 2. 安装 Docker 和 Docker Compose

下面是 Docker 官方的 apt 安装方法，Ubuntu 和 Debian 都适用：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release
curl -fsSL "https://download.docker.com/linux/$ID/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

检查是否可用：

```bash
docker --version
docker compose version
sudo docker run --rm hello-world
```

**应该看到**版本号，以及一段以 `Hello from Docker!` 开头的文字。

| 出现的问题 | 怎么办 |
| ---------- | ------ |
| `docker: 'compose' is not a docker command` | 没有装 Compose 插件，重新执行上面的 `apt-get install ... docker-compose-plugin`。本文所有命令都是 `docker compose`（中间是空格，不是横线） |
| `permission denied while trying to connect to the Docker daemon socket` | 当前用户没有权限。临时办法：命令前加 `sudo`。长期办法：`sudo usermod -aG docker $USER`，然后**退出 SSH 重新登录** |
| `Cannot connect to the Docker daemon` | `sudo systemctl start docker` |
| 国内服务器拉取镜像很慢或超时 | 在云服务商控制台查"Docker 镜像加速地址"，配置到 `/etc/docker/daemon.json` 的 `registry-mirrors`，然后 `sudo systemctl restart docker` |

> 🔒 **安全提示**：加入 `docker` 用户组的用户等同于拥有 root 权限。只把你信任的管理账号加进去。

---

## 3. 把项目文件放到服务器上

下面两种方法**选一种**。完成后，服务器上会有一个叫 `PurpleMoon-main` 的文件夹，里面能看到 `Dockerfile`。

**方法 A（推荐）：从你自己的电脑上传压缩包**

在**你自己的电脑**上，进入压缩包所在目录执行（把 `deploy`、`服务器IP` 换成你自己的）：

```bash
scp PurpleMoon-2.8.9.zip deploy@服务器IP:~/
```

首次连接会问 `Are you sure you want to continue connecting (yes/no)?`，输入 `yes` 回车。

回到**服务器**，解压：

```bash
cd ~
sudo apt-get install -y unzip
unzip -q PurpleMoon-2.8.9.zip
cd PurpleMoon-main
ls
```

**应该看到**列表里有 `Dockerfile`、`package.json`、`src`、`config.json` 等。

**方法 B：从 GitHub 仓库克隆**

```bash
cd ~
sudo apt-get install -y git
git clone https://github.com/PurpleSat/PurpleMoon.git PurpleMoon-main
cd PurpleMoon-main
ls
```

> 之后**所有命令都在 `PurpleMoon-main` 这个目录里执行**。如果中途断开了 SSH，重新登录后先执行 `cd ~/PurpleMoon-main`。
>
> 🔒 **只从你信任的来源获取代码**。压缩包来自第三方时，先确认来源可信再部署。

---

## 4. （内存不足 2GB 时）添加虚拟内存

构建镜像时 Next.js 会占用较多内存。1GB 内存的服务器构建可能出现 `Killed`。先查看：

```bash
free -h
```

看 `Mem:` 一行的 `total`。**不足 2GB 且 `Swap:` 为 0 的话**，添加 2GB 虚拟内存（内存够用的可以跳过本步）：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

**应该看到** `Swap:` 一行变成 `2.0Gi`。

---

## 5. 设置域名解析并放行端口

> 💡 本步放在构建之前做，因为 DNS 生效需要几分钟，可以和后面的构建并行等待。

### 5.1 添加解析记录

登录你的域名服务商的 DNS 管理页面，添加一条记录：

| 类型 | 主机记录 / 名称 | 记录值 / 指向 |
| ---- | --------------- | ------------- |
| A | `movie`（想用 `movie.example.com` 就填 `movie`；想直接用根域名就填 `@`） | 你服务器的**公网 IPv4 地址** |

> 在服务器上查看公网 IP：`curl -4 ifconfig.me`。
> 如果你用的是 Cloudflare：**先把这条记录的橙色云朵点成灰色（仅 DNS）**，等本站能正常访问、证书申请成功之后再决定是否开启代理（开启后还需要改 `TRUSTED_PROXY_HOPS`，见第 14 节）。

在**你自己的电脑**上检查解析是否生效：

```bash
nslookup movie.example.com
```

**应该看到**返回的 `Address` 是你服务器的 IP。刚添加时可能查不到，等 5～10 分钟再试。

### 5.2 放行 80 和 443 端口

需要在**两个地方**放行，缺一不可：

1. **云服务商控制台的"安全组 / 防火墙"**：入站规则里添加 TCP **80**、TCP **443**、UDP **443**（以及你的 SSH 端口）。
2. **服务器自己的防火墙**：如果你做了第 1.5 步，已经放行了。

如果服务器上已有别的程序占用 80/443（比如以前装过 Nginx/Apache），Caddy 会启动失败：

```bash
sudo ss -tlnp | grep -E ':80 |:443 '
```

有输出就说明被占用了，需要先停掉它。

---

## 6. 创建配置文件 `.env`

`.env` 里保存**域名、站长账号密码和各种密钥**。下面这条命令会**自动生成**随机的密钥和站长密码，你只需要改一项域名。

在 `PurpleMoon-main` 目录里，**整段复制**执行：

```bash
cat > .env <<EOF
# ===== 需要你修改的 1 项 =====
# 你的域名（必须已经解析到本服务器，不要写 http:// 或 https://）
DOMAIN=movie.example.com

# ===== 以下自动生成，不用改（站长密码只含字母数字，避免 .env 里的特殊字符问题）=====
USERNAME=admin
PASSWORD=$(openssl rand -hex 12)
AUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 16)

# ===== 可选 =====
# 是否开放注册：false=只有你自己用（推荐先保持 false）
ENABLE_REGISTER=false
# 国内服务器构建镜像慢或失败时，取消下一行注释，改用国内 npm 镜像
# NPM_REGISTRY=https://registry.npmmirror.com
EOF
chmod 600 .env
```

然后把域名改成你自己的：

```bash
sed -i 's|^DOMAIN=.*|DOMAIN=movie.example.com|' .env
```

**查看生成的站长密码并保存**（只此一次，请马上存进你的密码管理器）：

```bash
grep -E '^(USERNAME|PASSWORD)=' .env
```

检查有没有遗漏：

```bash
grep -E "example.com|请改成" .env || echo "OK：没有遗留的占位内容"
```

**应该看到** `OK：没有遗留的占位内容`。

> 如果提示 `openssl: command not found`：`sudo apt-get install -y openssl` 后重新执行第一段命令。
>
> 🔒 **`.env` 权限必须是 600**（只有你自己能读）。**不要**把它提交到 Git，不要发到聊天里。`AUTH_SECRET` 泄露意味着别人可以伪造登录状态；泄露后要重新生成并重启（所有人需要重新登录）。
>
> 💡 把 `.env` 另外保存到密码管理器里。丢了 `.env` 又没有备份，只能重新生成（登录状态会全部失效）。

---

## 7. 创建 `docker-compose.yml` 和 `Caddyfile`

**整段复制**执行，**命令里的 `<<'EOF'`（EOF 两边有单引号）不能漏**，否则里面的 `$$`、`${...}` 会被服务器提前替换，导致文件内容错误。

### 7.1 `docker-compose.yml`

```bash
cat > docker-compose.yml <<'EOF'
# PurpleMoon 2.8.9 加固版 docker-compose.yml
# 与官方 README 的版本相比，只加固、不改功能：网络隔离、最小权限、资源限额、日志限额。
# 说明：本文件语法已用 `docker compose config` 检查；首次部署后请按 README-Docker.md 第 9 步的验证清单逐项确认。

services:
  # ---------- 本站程序 ----------
  purplemoon:
    build:
      context: .
      args:
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmjs.org}
    image: purplemoon:2.8.9            # 写明版本号，避免 latest 分不清跑的是哪一版
    container_name: purplemoon
    restart: unless-stopped
    depends_on:
      purplemoon-redis:
        condition: service_healthy
    environment:
      - USERNAME=${USERNAME:?请在 .env 中设置 USERNAME}
      - PASSWORD=${PASSWORD:?请在 .env 中设置 PASSWORD}
      - AUTH_SECRET=${AUTH_SECRET:?请在 .env 中设置 AUTH_SECRET}
      - CRON_SECRET=${CRON_SECRET:?请在 .env 中设置 CRON_SECRET}
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://:${REDIS_PASSWORD:?请在 .env 中设置 REDIS_PASSWORD}@purplemoon-redis:6379
      - NEXT_PUBLIC_ENABLE_REGISTER=${ENABLE_REGISTER:-false}
      # 前面只有 Caddy 一层代理。若 Caddy 前面还有 CDN（如 Cloudflare 橙色云朵），这里的真实 IP 识别不再准确，
      # 需要额外配置，见 README-Docker.md 第 14 节；没有 CDN 时保持现状即可
      - TRUST_X_FORWARDED_FOR=true
      - TRUSTED_PROXY_HOPS=1
      # Turnstile 密钥填错导致站长也登不上时，取消下一行注释并重启，登录后修正密钥再注释回去
      # - TURNSTILE_DISABLED=true
    networks:
      - frontend      # 与 Caddy 通信，并负责对外访问资源站（需要出网）
      - backend       # 只用来访问 Redis
    # ---- 最小权限 ----
    # Dockerfile 里已经是 nextjs(1001) 非 root 用户
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    # 注意：这里不加 read_only: true。实测 start.js 每次启动都会写 /app/public/manifest.json，
    # 根文件系统只读会直接启动失败（EACCES）。
    tmpfs:
      - /tmp
    # ---- 资源限额：防止单个异常请求把宿主机拖垮 ----
    mem_limit: 768m
    cpus: 1.5
    pids_limit: 256
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    # 注意：故意没有 ports —— 只能被同一个 Compose 里的 Caddy 访问

  # ---------- 数据库 ----------
  purplemoon-redis:
    image: redis:7-alpine              # 建议部署后用 `docker image inspect` 取摘要，改成 redis@sha256:... 固定
    container_name: purplemoon-redis
    restart: unless-stopped
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD:?请在 .env 中设置 REDIS_PASSWORD}
    command:
      - sh
      - -c
      - exec redis-server --appendonly yes --requirepass "$$REDIS_PASSWORD" --maxmemory 400mb --maxmemory-policy noeviction
    volumes:
      - redis-data:/data
    networks:
      - backend                        # 只在内部网络上，不能出网，也不会被 Caddy 访问到
    user: "999:999"                    # redis 镜像里的 redis 用户。已有旧数据卷的升级方法见文末
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    pids_limit: 128
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" --no-auth-warning ping | grep -q PONG"]
      interval: 10s
      timeout: 3s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  # ---------- 门卫：HTTPS + 域名 ----------
  caddy:
    image: caddy:2                     # 同样建议固定到具体版本或摘要
    container_name: purplemoon-caddy
    restart: unless-stopped
    depends_on:
      purplemoon:
        condition: service_healthy
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      - DOMAIN=${DOMAIN:?请在 .env 中设置 DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data               # 保存 HTTPS 证书，请勿删除
      - caddy-config:/config
    networks:
      - frontend
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
    mem_limit: 256m
    pids_limit: 128
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

networks:
  frontend:
    ipam:
      config:
        - subnet: 172.29.0.0/24        # 固定网段，方便在宿主机上写出口防火墙规则（见 egress-firewall.sh）
  backend:
    internal: true                     # 内部网络：容器之间能通，但不能访问外网

volumes:
  redis-data:
  caddy-data:
  caddy-config:
EOF
```

### 7.2 `Caddyfile`

```bash
cat > Caddyfile <<'EOF'
{
	# 防慢速连接占满：只限制读请求头/请求体和空闲时间。
	# 故意不设写超时，因为搜索结果是边查边流式返回的。
	servers {
		timeouts {
			read_header 10s
			read_body   30s
			idle        2m
		}
	}
}

{$DOMAIN} {
	encode gzip zstd

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "SAMEORIGIN"
		-Server
	}

	# 后台导入配置等接口可能较大，给 10MB 上限，防超大请求体
	request_body {
		max_size 10MB
	}

	reverse_proxy purplemoon:3000 {
		# 搜索结果是边查边返回的，关闭缓冲才能实时看到
		flush_interval -1
		# 明确用真实来源地址覆盖客户端自带的 X-Forwarded-For，配合 TRUSTED_PROXY_HOPS=1
		header_up X-Forwarded-For {remote_host}
	}
}
EOF
```

### 7.3 这些配置做了什么（想了解可以看，不看也不影响部署）

| 配置 | 作用 |
| ---- | ---- |
| 应用容器没有 `ports` | 本站程序不对公网开放，只能被同一个 Compose 里的 Caddy 访问 |
| `backend` 网络 `internal: true` | 数据库所在网络不能出外网，也不会被 Caddy 访问到 |
| `cap_drop: ALL` + `no-new-privileges` | 容器拿掉所有 Linux 特权，并且不能通过程序提权 |
| Redis `user: 999:999` + `read_only` | 数据库不用 root 运行，根文件系统只读 |
| `maxmemory 400mb` + `noeviction` | 内存满时拒绝写入，而不是悄悄删用户数据 |
| `mem_limit`、`cpus`、`pids_limit` | 防止单个异常请求把整台服务器拖垮 |
| `logging ... max-size` | 日志每个文件最大 10MB、保留 3 个，防止磁盘被日志写满 |
| 固定镜像标签 `purplemoon:2.8.9` | 能分清当前运行的是哪个版本 |
| Caddy 的超时、请求体上限、安全响应头 | 防慢速连接占满、防超大请求体，浏览器端启用 HSTS 等保护 |
| `header_up X-Forwarded-For {remote_host}` | 让本站拿到真实访问者 IP（登录限流按 IP 计算依赖它），并且客户端无法伪造 |

> 应用容器**没有**设置 `read_only`：本站每次启动都会写 `public/manifest.json`，根文件系统只读会直接启动失败。这是实测结果，不是疏漏。
>
> 子网 `172.29.0.0/24` 如果与你服务器上已有的网络冲突（`docker network ls` / `ip route` 能看到），换成别的私有网段，并同步修改第 11 节脚本里的 `SUBNET`。

---

## 8. 检查配置、构建并启动

### 8.1 检查配置文件有没有写错

```bash
docker compose config -q && echo "配置文件格式正确"
```

**应该看到** `配置文件格式正确`。如果报错：

- 提示 `请在 .env 中设置 xxx`：`.env` 里缺了这一项，回第 6 步补上。
- 提示 `yaml: ...` 或 `unknown ...`：`docker-compose.yml` 被复制坏了，回第 7 步重新复制。

### 8.2 构建并启动（第一次需要 3～10 分钟）

```bash
docker compose up -d --build
```

屏幕上会滚动大量文字，这是在下载基础镜像、安装依赖、编译网站，**请耐心等待，不要中断**。结束时应该看到类似：

```
 ✔ Container purplemoon-redis   Healthy
 ✔ Container purplemoon         Healthy
 ✔ Container purplemoon-caddy   Started
```

> 构建中途出现 `Killed`：内存不足，回第 4 步加虚拟内存后重试。
> 构建卡在 `pnpm install` 或报网络错误：在 `.env` 里启用 `NPM_REGISTRY=https://registry.npmmirror.com` 那行，重新执行本命令。

### 8.3 查看运行状态

```bash
docker compose ps
```

**应该看到**三个容器都是 `Up ...`，其中前两个带 `(healthy)`：

```
NAME                 STATUS
purplemoon           Up 1 minute (healthy)
purplemoon-caddy     Up 1 minute
purplemoon-redis     Up 1 minute (healthy)
```

如果 `purplemoon` 一直是 `starting`，等一分钟再看；如果 `unhealthy` 或反复 `Restarting`：

```bash
docker compose logs --tail 50 purplemoon
```

### 8.4 在服务器内部检查本站程序是否正常

```bash
docker compose exec purplemoon wget -qO- http://127.0.0.1:3000/login | head -c 200
```

**应该看到**一小段以 `<!DOCTYPE html>` 开头的网页源码。

### 8.5 用域名访问，并确认 HTTPS 生效

看 Caddy 是否申请到证书：

```bash
docker compose logs --tail 30 caddy
```

**应该看到**包含 `certificate obtained successfully` 的日志行。

在**你自己电脑的浏览器**输入 `https://你的域名`。**应该看到**地址栏有小锁图标，并显示本站的登录页。也可以用命令检查：

```bash
curl -I https://movie.example.com
```

**应该看到**第一行是 `HTTP/2 200` 或 `HTTP/2 307`（跳转到登录页，也正常），并且响应头里有 `strict-transport-security`。

---

## 9. 部署后验证清单

**这一步不能省**：确认安全配置真的生效了。在服务器的 `PurpleMoon-main` 目录执行。

| # | 检查什么 | 命令 | 应该看到 |
| - | -------- | ---- | -------- |
| 1 | 三个容器都健康 | `docker compose ps` | `purplemoon`、`purplemoon-redis` 为 `healthy`，Caddy 为 `Up` |
| 2 | 只有 80/443 对外 | `sudo ss -tlnp \| grep -E ':3000\|:6379'` | **没有任何输出**（3000 和 6379 不在宿主机监听） |
| 3 | Redis 不带密码会被拒绝 | `docker compose exec purplemoon-redis redis-cli ping` | `NOAUTH Authentication required.` |
| 4 | Redis 带密码能用 | `docker compose exec purplemoon-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping'` | `PONG` |
| 5 | 数据库不能出外网 | `docker compose exec purplemoon-redis wget -T 5 -qO- http://example.com; echo "退出码 $?"` | 失败（退出码不是 0） |
| 6 | 应用容器是非 root | `docker compose exec purplemoon id` | `uid=1001(nextjs)` |
| 7 | 权限已被收紧 | `docker inspect purplemoon --format '{{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}'` | `[ALL] [no-new-privileges:true]` |
| 8 | 站点能打开且有 HSTS | `curl -sI https://你的域名 \| grep -i strict` | 有 `strict-transport-security` 一行 |
| 9 | 重启后数据仍在 | 先在站内登录并收藏一个视频，`docker compose restart`，再看收藏 | 收藏还在 |

> 第 5 项说明：Redis 容器在内部网络里，没有出网路由，所以访问外网应失败；如果它**成功了**，说明网络配置被改坏了，不要继续上线。
> 第 2 项如果有输出，说明有人给容器加了 `ports:` 把端口发布到了宿主机，请删掉。

---

## 10. 第一次登录与基本设置

1. 打开 `https://你的域名`，进入登录页。
2. 用户名填 `.env` 里的 `USERNAME`，密码填 `PASSWORD`，登录。这个账号就是**站长**。
3. 访问 `https://你的域名/admin` 进入后台，可以：管理用户、设置是否开放注册、调整资源站、给用户分组等。
4. **想让朋友也能注册**（登录页没有「注册」入口是正常的，要先开启）：
   1. 在后台用户配置里打开「开放注册」开关并保存，**立即生效**，无需重启。
   2. 在后台「邀请码」管理里添加邀请码（可设置使用次数、有效期、绑定分组），并打开「强制邀请码」开关；把邀请码发给朋友。
   3. ⚠️ 只改 `.env` 里的 `ENABLE_REGISTER` 可能没用：它只是「后台还没保存过设置时的初始默认值」。后台保存过设置后，**以后台开关为准**。
5. 🔒 **不要长期开放注册却不设邀请码**：任何人都能注册，并且能使用你服务器的资源。
6. 可选：启用 **Cloudflare Turnstile 人机验证**（后台设置里填 Site Key 和 Secret Key）。⚠️ 密钥填错会让**包括站长在内的所有人都无法登录**。应急办法：编辑 `docker-compose.yml`，取消 `# - TURNSTILE_DISABLED=true` 的注释，执行 `docker compose up -d`，登录后台改正密钥，再把这行注释回去并再次 `docker compose up -d`。

---

## 11. 可选加固：出口防火墙

**为什么需要**：本站有几个功能会"替用户去访问外部地址"（资源站、图片代理等）。代码里已经做了地址检查，但"检查之后程序再次解析域名"之间仍有一个极小的时间窗（DNS 重绑定）。在宿主机上加一道防火墙，可以让这类攻击即使成功也无法碰到你的内网、云厂商元数据地址（`169.254.169.254`）和宿主机自身。

**适合谁**：服务器在云厂商内网里、同一内网还有其他机器或服务时，强烈建议做。

在 `PurpleMoon-main` 目录创建并执行（需要 root 权限，**在 `docker compose up -d` 之后执行**）：

```bash
cat > egress-firewall.sh <<'EOF'
#!/bin/bash
# 可选：宿主机出口防火墙，禁止 purplemoon 容器访问内网、云元数据地址和宿主机自身。
# 这是资源站请求、图片代理等“替用户访问外部地址”功能的最后一道防线，
# 用来补上代码里 DNS 重绑定的极小时间窗。需要 root 权限，在 `docker compose up -d` 之后执行。
# 注意：这些规则没有在所有环境下验证过，请先在测试机上试，并确认站点和搜索仍然正常。
set -euo pipefail
SUBNET=172.29.0.0/24      # 必须与 docker-compose.yml 中 frontend 网络的 subnet 一致

# 1) 容器 -> 其他私网/元数据网段：丢弃（用 -I 插入，所以先写“丢弃”，最后写“放行同网段”，放行规则最终在最上面）
for NET in 169.254.0.0/16 100.64.0.0/10 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP 2>/dev/null || \
    iptables -I DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP
done
# 2) 本网段内部（purplemoon <-> caddy）放行
iptables -C DOCKER-USER -s "$SUBNET" -d "$SUBNET" -j ACCEPT 2>/dev/null || \
  iptables -I DOCKER-USER -s "$SUBNET" -d "$SUBNET" -j ACCEPT
# 3) 容器 -> 宿主机自身（走 INPUT 链）：只放行已建立的连接
iptables -C INPUT -s "$SUBNET" -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP 2>/dev/null || \
  iptables -I INPUT -s "$SUBNET" -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP

echo "已设置。持久化请用 netfilter-persistent / iptables-persistent 保存，否则重启后失效。"
EOF
chmod +x egress-firewall.sh
sudo ./egress-firewall.sh
```

让规则在服务器重启后依然生效（Ubuntu/Debian）：

```bash
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

验证（**应该失败**）：

```bash
docker compose exec purplemoon wget -T 5 -qO- http://169.254.169.254/ ; echo "退出码 $?"
```

再确认站点和搜索仍然正常。

> ⚠️ 这些规则**没有在所有环境下验证过**。请先确认站点功能正常；如果出问题，用下面的命令撤销：
> ```bash
> sudo iptables -D DOCKER-USER -s 172.29.0.0/24 -d 172.29.0.0/24 -j ACCEPT
> for N in 169.254.0.0/16 100.64.0.0/10 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do sudo iptables -D DOCKER-USER -s 172.29.0.0/24 -d $N -j DROP; done
> sudo iptables -D INPUT -s 172.29.0.0/24 -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP
> ```
> 如果你的资源站、图片源本身就部署在内网，这些规则会让它们无法访问，需要按需调整。

---

## 12. 日常运维、升级、备份与恢复

以下命令都需要先 `cd ~/PurpleMoon-main`。

### 12.1 日常命令

| 想做什么 | 命令 |
| -------- | ---- |
| 查看所有容器状态 | `docker compose ps` |
| 实时查看本站日志（`Ctrl + C` 退出） | `docker compose logs -f purplemoon` |
| 查看最近 100 行日志 | `docker compose logs --tail 100 purplemoon` |
| 重启本站 | `docker compose restart purplemoon` |
| 修改了 `.env` 或 `docker-compose.yml` 后使配置生效 | `docker compose up -d` |
| 停止全部服务（数据保留） | `docker compose stop` |
| 再次启动 | `docker compose start` |
| 停止并删除容器（**数据卷保留**） | `docker compose down` |
| 查看资源占用 | `docker stats --no-stream` |
| 清理旧镜像与构建缓存 | `docker image prune -f && docker builder prune -f` |

> ⚠️ **千万不要执行 `docker compose down -v`**：多出来的 `-v` 会**同时删除数据卷**，也就是所有用户、收藏、播放记录和 HTTPS 证书。

服务器重启后，容器会自动恢复（已设置 `restart: unless-stopped`，并在第 2 步 `systemctl enable docker`），不需要你做任何事。

### 12.2 添加其它环境变量（例如 `TMDB_API_TOKEN`）

分**两步**，缺一不可：

**第 1 步：在 `.env` 末尾加一行**（密钥放这里，不要写进 `docker-compose.yml`）：

```bash
echo 'TMDB_API_TOKEN=你的TMDB读访问令牌' >> .env
```

**第 2 步：把它传进容器**。`.env` 只是给 Compose 自己读取的，**不会自动传进容器**：

```bash
sed -i 's|^      - TRUSTED_PROXY_HOPS=1$|      - TRUSTED_PROXY_HOPS=1\n      - TMDB_API_TOKEN=${TMDB_API_TOKEN:-}|' docker-compose.yml
grep -n TMDB docker-compose.yml
docker compose up -d
docker compose exec purplemoon sh -c 'test -n "$TMDB_API_TOKEN" && echo 已生效 || echo 未生效'
```

其它变量（`SITE_NAME`、`ANNOUNCEMENT`、`NEXT_PUBLIC_IMAGE_PROXY` 等）都按同样两步添加：`.env` 写值 → `environment:` 加 `- 变量名=${变量名:-}`。

### 12.3 升级到新版本

1. **先备份**（见 12.4）。
2. 把新版压缩包上传到服务器：`scp PurpleMoon-新版本.zip deploy@服务器IP:~/`。
3. 在服务器上执行（把文件名换成实际的）：

```bash
cd ~
mkdir -p upgrade-tmp && unzip -q -o PurpleMoon-新版本.zip -d upgrade-tmp
cp -a upgrade-tmp/PurpleMoon-main/. PurpleMoon-main/
rm -rf upgrade-tmp
cd PurpleMoon-main
# 把 docker-compose.yml 里的镜像版本号改成新版本（例如 2.9.0）
sed -i 's|image: purplemoon:.*|image: purplemoon:2.9.0|' docker-compose.yml
docker compose up -d --build
docker image prune -f
```

这样会用新代码覆盖旧代码，**不会动你的 `.env`、`docker-compose.yml`、`Caddyfile`**（新压缩包里没有这三个文件），数据保留在数据卷里。更新完成后用 `docker compose ps` 确认都是 `healthy`，再做一遍第 9 步的验证清单。

> 如果新版说明里提示新增了必填环境变量，请先补进 `.env`，并在 `docker-compose.yml` 的 `environment:` 里按相同格式加一行。
>
> 🔒 **定期更新**：基础镜像（Node、Redis、Caddy）和系统都会发布安全更新。建议每月 `sudo apt-get upgrade -y`、`docker compose pull purplemoon-redis caddy && docker compose up -d --build` 一次。想固定镜像版本，可以用 `docker image inspect --format '{{index .RepoDigests 0}}' redis:7-alpine` 取到摘要，把 `docker-compose.yml` 里的 `image:` 改成 `redis@sha256:...` 的形式（Caddy 同理）。

### 12.4 备份

需要备份三样东西：

| 备份对象 | 为什么 | 怎么备份 |
| -------- | ------ | -------- |
| `.env` | 里面有所有密钥与密码 | `cp .env ~/env-backup-$(date +%F)` 后下载到你自己的电脑，存进密码管理器 |
| Redis 数据卷 | 用户、收藏、播放记录、后台设置 | 见下 |
| `docker-compose.yml`、`Caddyfile` | 配置文件，丢了可以按本指南重新生成 | 随手复制一份即可 |

备份 Redis 数据（先让它把数据写盘，再打包）：

```bash
docker compose exec purplemoon-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE'
sleep 3
docker run --rm -v purplemoon-main_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/redis-backup-$(date +%F).tgz -C /data .
ls -lh redis-backup-*.tgz
```

> `purplemoon-main_redis-data` 是"项目目录名（小写）+ 数据卷名"。如果你的目录名不是 `PurpleMoon-main`，用 `docker volume ls` 找到以 `_redis-data` 结尾的那一项替换。

把备份下载到你自己的电脑保存：

```bash
# 在你自己的电脑上执行
scp deploy@服务器IP:~/PurpleMoon-main/redis-backup-*.tgz .
```

> 🔒 备份里含有用户名、密码哈希和播放记录，**当作敏感数据**：加密存放，不要放在公开的网盘或仓库里。建议加一个定时任务每天备份并只保留最近 7 份。

### 12.5 恢复

```bash
docker compose stop purplemoon purplemoon-redis
docker run --rm -v purplemoon-main_redis-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/redis-backup-日期.tgz -C /data && chown -R 999:999 /data"
docker compose start purplemoon-redis purplemoon
```

最后一个 `chown -R 999:999` 不能省：Redis 在本指南里用 999 用户运行，数据文件必须属于它，否则 Redis 会因为无法写入而启动失败。

---

## 13. 从旧的 README 部署方式迁移

如果你之前用项目 README 里的 `docker-compose.yml`（Redis 以 root 运行、三个容器在同一个网络），升级为本指南的加固版时，**数据卷里的文件属于 root，新的 Redis 用 999 用户运行会写入失败**。迁移步骤：

```bash
cd ~/PurpleMoon-main
# 1. 先按 12.4 备份 .env 和 Redis 数据！
# 2. 停止旧容器（不要加 -v）
docker compose down
# 3. 修改数据卷的属主（一次性）
docker run --rm -v purplemoon-main_redis-data:/data alpine chown -R 999:999 /data
# 4. 用第 7 步的内容覆盖 docker-compose.yml 和 Caddyfile（先把旧的备份一份：cp docker-compose.yml docker-compose.yml.old）
# 5. 检查并启动
docker compose config -q && echo "配置文件格式正确"
docker compose up -d --build
```

然后做一遍第 9 步的验证清单。旧文件里如果有你自己加的环境变量（如 `TMDB_API_TOKEN`），要照 12.2 重新加回新文件。

---

## 14. 常见问题排查

| 现象 | 可能原因 | 解决办法 |
| ---- | -------- | -------- |
| `docker compose up` 提示 `请在 .env 中设置 xxx` | `.env` 缺少这一项，或不在 `docker-compose.yml` 同一目录 | 回第 6 步补上；确认当前位于 `PurpleMoon-main` 目录 |
| 构建时 `Killed` | 内存不足 | 第 4 步添加虚拟内存后重试 |
| 构建卡在 `pnpm install` 或网络超时 | 访问 npm 官方源太慢 | `.env` 里启用 `NPM_REGISTRY=https://registry.npmmirror.com` 后重新构建 |
| `purplemoon` 容器一直 `Restarting` | 常见是 `AUTH_SECRET` 缺失或太短 | `docker compose logs --tail 50 purplemoon`，检查 `.env` |
| `purplemoon-redis` 一直 `Restarting` 或日志里有 `Permission denied` | 数据卷里的文件属主不是 999（常见于从旧版迁移） | 按第 13 节执行 `chown -R 999:999` |
| Redis 日志 `OOM command not allowed` | 数据超过了 `maxmemory 400mb` 的上限 | 把 `docker-compose.yml` 里 `--maxmemory` 和 `mem_limit` 同步调大，再 `docker compose up -d` |
| 浏览器显示"无法访问此网站" | 域名没解析到本机，或 80/443 没放行 | 第 5 步：`nslookup` 检查解析；安全组和 `ufw` 都要放行 |
| 浏览器提示证书错误 | Caddy 还没申请到证书 | `docker compose logs caddy`；确认解析已生效、80 端口可从公网访问；Cloudflare 用户先关闭橙色云朵 |
| Caddy 日志反复 `challenge failed` | 公网访问不到你的 80 端口 | 检查云安全组、防火墙、备案限制 |
| Caddy 日志 `no valid A records` | 解析还没生效，或 `DOMAIN` 写错 | 等解析生效；`grep DOMAIN .env` |
| Caddy 起不来，提示端口被占用 | 服务器上已有 Nginx/Apache | `sudo ss -tlnp \| grep -E ':80 \|:443 '` 查占用并停掉 |
| Caddy 起不来，日志里提示 Caddyfile 语法错误（如不认识 `timeouts`） | Caddy 版本过旧 | `docker compose pull caddy && docker compose up -d`，或删掉 Caddyfile 开头的 `servers { ... }` 块 |
| 访问提示 502 Bad Gateway | 本站程序没起来或还在启动 | `docker compose ps`；`docker compose logs purplemoon` |
| 登录后又回到登录页 | 用 `http://` 访问，Cookie 没写成功 | 用 `https://域名` 访问 |
| 提示"尝试登录过于频繁" | 触发了登录限流 | 等 1 分钟（同一 IP）或 15 分钟（同一账号）后再试 |
| 所有人都被当成同一个 IP，一个人输错就大家被限流 | 没有正确识别真实 IP | 确认 `.env`/`docker-compose.yml` 里 `TRUST_X_FORWARDED_FOR=true`、`TRUSTED_PROXY_HOPS=1`；**如果 Caddy 前面还有 Cloudflare 等 CDN，要改成 `TRUSTED_PROXY_HOPS=2`**，并把 Caddyfile 里的 `header_up X-Forwarded-For {remote_host}` 那一行删掉 |
| 搜索不到结果或图片加载不出来 | 出口防火墙规则挡住了资源站 | 检查第 11 节规则；资源站在内网时需要调整 |
| 改了 `.env` 没效果 | 没有重新创建容器，或新增变量没写进 `environment:` | `docker compose up -d`（不是 `restart`）；见 12.2 |
| 登录页没有「注册」入口 | 后台开关未开 | 站长登录 `/admin`，打开「开放注册」 |
| 站长也登录不了，提示需要人机验证 | Turnstile 密钥填错 | 见第 10 节第 6 点的应急办法 |
| 磁盘越来越满 | 旧镜像和构建缓存累积 | `docker image prune -f && docker builder prune -f` |
| 忘记站长密码 | — | 改 `.env` 里的 `PASSWORD`，然后 `docker compose up -d` |

如果以上都不能解决，请收集下面三段输出再向别人求助（**发出去之前把里面的密码、密钥抹掉**）：

```bash
docker compose ps
docker compose logs --tail 100 purplemoon
docker compose logs --tail 50 caddy
```

---

## 15. 安全检查清单

部署完成后逐项打勾：

- [ ] SSH 用密钥登录，已禁用密码登录和 root 登录；系统开启了自动安全更新。
- [ ] 服务器防火墙只放行 SSH、80、443（TCP）和 443（UDP）。
- [ ] 第 9 步验证清单的 9 项都通过（尤其是 `3000`、`6379` 不在宿主机监听）。
- [ ] `.env` 权限为 `600`，没有提交到任何仓库；`PASSWORD`、`AUTH_SECRET` 已保存到密码管理器。
- [ ] 没有给任何容器随手加 `ports:`。
- [ ] 需要开放注册时，已在后台创建邀请码并开启「强制邀请码」。
- [ ] 已备份 `.env` 和 Redis 数据，并且**试过恢复**。
- [ ] （可选但推荐）已配置第 11 节的出口防火墙，并验证云元数据地址不可访问。
- [ ] 知道升级流程，并计划每月更新系统和镜像。

### 本部署方式下已知的安全局限

- 应用层对"替用户访问外部地址"的功能做了地址检查，但没有覆盖所有情况（例如域名解析后再次连接之间的 DNS 重绑定）；第 11 节的出口防火墙就是用来补这个缺口的。
- 2.8.9 起已移除服务端播放列表代理（`/api/proxy-m3u8`）：不支持 MSE 的旧设备（如较旧的 iPhone Safari）播放时直接访问原始地址，无法在前端去广告。
- 本站程序容器没有启用只读根文件系统（原因见 7.3）。
