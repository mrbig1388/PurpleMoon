# PurpleMoon

<div align="center">
  <img src="public/logo.png" alt="PurpleMoon Logo" width="120">
</div>

> 🎬 PurpleMoon 是一个跨平台的影视聚合播放器。它基于 **Next.js 15** + **Tailwind&nbsp;CSS** + **TypeScript** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、本地/云端存储，让你可以随时随地畅享海量影视内容。**多源聚合搜索**：内置数十个资源站点，一次搜索立刻返回全源结果；**丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示；**流畅在线播放**：集成 HLS.js & ArtPlayer；**收藏 + 继续观看**：支持 Redis/D1 存储，多端同步进度，自动跳过片头片尾；**PWA**：离线缓存、安装到桌面/主屏，移动端原生体验；**响应式布局**：桌面底部导航 + 移动底部导航，自适应各种屏幕尺寸。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-15.5.28-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4.19-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.1.6-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![HLS](https://img.shields.io/badge/HLS-1.7.3-8A2BE2)
![Artplayer](https://img.shields.io/badge/Artplayer-5.4.0-RED)
![Version](https://img.shields.io/badge/Version-2.8.9-red)
![Github](https://img.shields.io/badge/github-PurpleSat-8A2BE2?logo=github)

</div>

---

## 目录

- [🔍技术栈](#技术栈)
- [🚀部署](#部署)
  - [🌐Vercel](#vercel-部署)
  - [🌐Cloudflare](#cloudflare-部署)
  - [🌐Docker 与 Docker Compose](#docker-部署)
- [📄环境变量](#环境变量)
- [📱不同部署环境的变量配置](#不同部署环境的变量配置)
- [🌗部署与 IP 识别](#部署与-ip-识别)
- [👿配置说明](#配置说明)
- [🔒管理员配置](#管理员配置)
- [▶️AndroidTV 使用](#androidtv-使用)
- [💬更新记录](#更新记录)
- [🎬Roadmap](#roadmap)
- [🔔License](#license)
- [❤️致谢](#致谢)

---

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 15](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 5                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · Cloudflare Pages                                                                    |

## 部署

本项目**支持 Vercel、Docker 和 Cloudflare** 部署。

### 存储支持矩阵

|               | Docker | Vercel | Cloudflare |
| :-----------: | :----: | :----: | :--------: |
| localstorage  |   ✅   |   ✅   |     ✅     |
|  原生 Redis   |   ✅   |        |            |
| Cloudflare D1 |        |        |     ✅     |
| Upstash Redis |   ✅   |   ✅   |     ✅     |

✅：经测试支持。除 localstorage 外，其他方式都支持多账户、记录同步和管理页面。

### Vercel 部署

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Vercel](https://vercel.com/)，点击 **Add New → Project**，选择 Fork 后的仓库。
3. （强烈建议）设置 PASSWORD 环境变量。
4. 保持默认设置完成首次部署。
5. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
6. 每次 Push 到 `main` 分支将自动触发重新构建。

部署完成后即可通过分配的域名访问，也可以绑定自定义域名。

#### Upstash Redis 支持

0. 完成普通部署并成功访问。
1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Vercel 项目，新增环境变量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值为第二步复制的 endpoint 和 token
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **upstash**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Cloudflare 部署

**Cloudflare Pages 的环境变量尽量设置为密钥而非文本**

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Cloudflare](https://cloudflare.com)，点击 **计算（Workers）-> Workers 和 Pages**，点击创建
3. 选择 Pages，导入现有的 Git 存储库，选择 Fork 后的仓库
4. 构建命令填写 **pnpm install --frozen-lockfile && pnpm run pages:build**，预设框架为无，构建输出目录为 `.vercel/output/static`
5. 保持默认设置完成首次部署。进入设置，将兼容性标志设置为 `nodejs_compat`
6. （强烈建议）首次部署完成后进入设置，新增 PASSWORD 密钥（变量和机密下），而后重试部署。
7. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
8. 每次 Push 到 `main` 分支将自动触发重新构建。

#### D1 支持

0. 完成普通部署并成功访问
1. 点击 **存储和数据库 -> D1 SQL 数据库**，创建一个新的数据库，名称随意
2. 进入刚创建的数据库，点击左上角的 Explore Data，将[D1 初始化1](D1-1.md) [D1 初始化2](D1-2.md)中的内容粘贴到 Query 窗口后点击 **Run All**，等待运行完成
3. 返回你的 pages 项目，进入 **设置 -> 绑定**，添加绑定 D1 数据库，选择你刚创建的数据库，变量名称填 **DB**
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **d1**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Docker 部署

> 🔒 **推荐阅读 [README-Docker.md](README-Docker.md)**：加固版 Docker 部署指南（网络隔离、最小权限、资源限额、验证清单、出口防火墙），从全新服务器开始一步一步操作。下面是原有的基础版步骤。

本章写给**第一次自己部署网站的人**：从服务器上 Docker 与 Docker Compose 已经装好之后的第一条命令开始，一步一步做到「别人在浏览器输入你的域名就能打开本站」。每一步都写了**要做什么、为什么、命令、应该看到什么、出错怎么办**。照着复制粘贴即可。

> **注意**：本仓库不提供公开的预构建镜像（Docker 镜像名必须全小写，且 `ghcr.io` 上的包默认私有，直接 `docker pull` 会报 `denied`）。所以下面的流程是**在你自己的服务器上用源码构建镜像**，这一步全自动，只是第一次需要等几分钟。

#### 0. 先看懂：我们要搭出什么样子

```
 访问者的浏览器
      │  https://movie.example.com      （你的域名）
      ▼
 ┌────────────────────────── 你的服务器 ──────────────────────────┐
 │  Caddy 容器    监听 80 / 443，自动申请并续期 HTTPS 证书         │
 │      │  内部转发                                                │
 │      ▼                                                         │
 │  purplemoon 容器   本站程序，监听 3000（不对公网开放）          │
 │      │  内部连接                                                │
 │      ▼                                                         │
 │  purplemoon-redis 容器   保存用户、收藏、播放记录（不对公网开放）│
 └────────────────────────────────────────────────────────────────┘
```

- **只有 Caddy 对公网开放 80 和 443 端口**，本站程序和数据库只在服务器内部互相访问，这是最安全也最不容易出错的做法。
- Caddy 是一个会**自动申请 HTTPS 证书**的反向代理，比 Nginx 少很多配置，最适合新手。如果你更熟悉 Nginx，看本章的「路线 B」。

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
| 一台 Linux 服务器 | Ubuntu 22.04 / 24.04 或 Debian 12 最省事；建议 **1 核 2GB 内存**以上；有公网 IP |
| 已安装 Docker 和 Docker Compose | 下面第 1 步会检查 |
| 一个域名 | 已购买，且你能进入它的 DNS 解析管理页面 |
| 你的电脑能 SSH 登录服务器 | Windows 10/11 自带的 PowerShell、macOS/Linux 的终端都可以 |
| 本项目的压缩包 | 例如 `PurpleMoon-2.6.3.zip` |

> 💡 **在国内服务器上用域名对外提供网站，域名通常需要先完成 ICP 备案**，否则 80/443 端口可能被服务商拦截。这是服务商和法规要求，与本项目无关；没有备案时可使用境外服务器。

---
#### Docker 和 Docker Compose安装步骤

1.更新软件包并安装必要软件

```bash
sudo apt update
sudo apt install apt-transport-https curl
```
2.导入 Docker 官方 GPG 密钥
```bash
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
```
3.添加 Docker 官方仓库
```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```
4.更新软件包
```bash
sudo apt update
```
5.安装 Docker
```bash
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```
6.安装官方推荐的 Docker Compose V2 CLI 插件
```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version 
```
#### 1. 检查 Docker 和 Docker Compose 是否可用

登录服务器后，依次执行：

```bash
docker --version
docker compose version
```

**应该看到**类似下面的版本号（具体数字不同没关系）：

```
Docker version 27.3.1, build ce12230
Docker Compose version v2.29.7
```

再执行一次"真实运行"测试：

```bash
docker run --rm hello-world
```

**应该看到**一段以 `Hello from Docker!` 开头的文字。

| 出现的问题 | 怎么办 |
| ---------- | ------ |
| `docker: command not found` | Docker 还没装好，请先按 Docker 官方文档安装 |
| `docker: 'compose' is not a docker command` | 装的是旧版，没有 Compose 插件。请安装 Docker 官方的 `docker-compose-plugin`；本文所有命令都是 `docker compose`（中间是空格，不是横线） |
| `permission denied while trying to connect to the Docker daemon socket` | 当前用户没有权限。临时办法：每条 docker 命令前加 `sudo`。长期办法：执行 `sudo usermod -aG docker $USER`，然后**退出 SSH 重新登录** |
| `Cannot connect to the Docker daemon` | Docker 服务没启动：`sudo systemctl start docker` |

顺手设置开机自启，服务器重启后容器才能自动恢复：

```bash
sudo systemctl enable docker
```

---

#### 2. 把项目文件放到服务器上

下面两种方法**选一种**。完成后，服务器上会有一个叫 `PurpleMoon-main` 的文件夹，里面能看到 `Dockerfile`。

**方法 A（推荐）：从你自己的电脑上传压缩包**

在**你自己的电脑**（不是服务器）上打开终端（Windows 用 PowerShell），进入压缩包所在目录，执行（把 `root`、`服务器IP` 换成你自己的）：

```bash
scp PurpleMoon-2.6.3.zip root@服务器IP:~/
```

首次连接会问 `Are you sure you want to continue connecting (yes/no)?`，输入 `yes` 回车，再输入服务器登录密码。

> 不习惯命令行的话，也可以用图形工具 WinSCP 或 FileZilla，把压缩包拖到服务器的 `~`（登录用户的家目录）里。

然后回到**服务器**，解压：

```bash
cd ~
sudo apt-get update && sudo apt-get install -y unzip   # 已装过 unzip 可跳过；CentOS/Rocky 用 sudo dnf install -y unzip
unzip -q PurpleMoon-2.6.3.zip
cd PurpleMoon-main
ls
```

**应该看到**列表里有 `Dockerfile`、`package.json`、`src`、`config.json` 等。

**方法 B：直接从 Github 仓库克隆**

```bash
cd ~
git clone https://github.com/purplesat/purplemoon.git PurpleMoon-main
cd PurpleMoon-main
ls
```

> 之后**所有命令都在 `PurpleMoon-main` 这个目录里执行**。如果中途断开了 SSH，重新登录后先执行 `cd ~/PurpleMoon-main`。

---

#### 3. （内存不足 2GB 时）添加虚拟内存

构建镜像时 Next.js 会占用较多内存。如果你的服务器内存只有 1GB，构建过程可能出现 `Killed` 而失败。先查看：

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

#### 4. 设置域名解析并放行端口

> 💡 **本步放在构建之前做**，因为 DNS 生效需要几分钟，可以和后面的构建并行等待。

**4.1 添加解析记录**

登录你的域名服务商的 DNS 管理页面，添加一条记录：

| 类型 | 主机记录 / 名称 | 记录值 / 指向 |
| ---- | --------------- | ------------- |
| A | `movie`（想用 `movie.example.com` 就填 `movie`；想直接用根域名 `example.com` 就填 `@`） | 你服务器的**公网 IPv4 地址** |

> 在服务器上查看公网 IP：`curl -4 ifconfig.me`。
> 如果你用的是 Cloudflare：**先把这条记录的橙色云朵点成灰色（仅 DNS）**，等本站能正常访问、证书申请成功之后再决定是否开启代理，否则容易因为证书验证失败而卡住。

在**你自己的电脑**上检查解析是否生效（把域名换成你的）：

```bash
nslookup movie.example.com
```

**应该看到**返回的 `Address` 是你服务器的 IP。刚添加时可能查不到，等 5～10 分钟再试；最长可能需要数小时。

**4.2 放行 80 和 443 端口**

需要在**两个地方**放行，缺一不可：

1. **云服务商控制台的"安全组 / 防火墙"**：入站规则里添加 TCP **80** 和 TCP **443**（以及你的 SSH 端口，默认 22，通常已有）。
2. **服务器自己的防火墙**（如果启用了）。Ubuntu 的 `ufw` 用下面命令，**一定要先放行 SSH 再启用，否则会把自己锁在门外**：

```bash
sudo ufw status
```

如果显示 `Status: inactive`，说明没启用，**什么都不用做**。如果是 `active`，执行：

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw status
```

> 如果服务器上已经有别的程序占用了 80/443（比如以前装过 Nginx/Apache），Caddy 会启动失败。用 `sudo ss -tlnp | grep -E ':80 |:443 '` 检查；有输出就说明被占用了，需要先停掉它，或改用下面的「路线 B」。

---

#### 5. 创建配置文件 `.env`

`.env` 里保存**域名、站长账号密码和各种密钥**。下面这条命令会**自动生成**随机的密钥，你只需要再改三项。

在 `PurpleMoon-main` 目录里，**整段复制**执行：

```bash
cat > .env <<EOF
# ===== 需要你修改的 3 项 =====
# 1) 你的域名（必须已经解析到本服务器，不要写 http:// 或 https://）
DOMAIN=movie.example.com
# 2) 站长账号（登录后台用）
USERNAME=admin
# 3) 站长密码（请改成你自己的强密码）
PASSWORD=请改成你的强密码

# ===== 以下自动生成，不用改 =====
AUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 16)

# ===== 可选 =====
# 是否开放注册：false=只有你自己用；true=别人凭邀请码可以注册
ENABLE_REGISTER=false
# 国内服务器构建镜像慢或失败时，取消下一行注释，改用国内 npm 镜像
# NPM_REGISTRY=https://registry.npmmirror.com
EOF
chmod 600 .env
```

然后改那三项。**如果提示 `nano: command not found`，说明服务器没装 nano，下面三种方法任选其一：**

**方法 1（最简单，不需要编辑器）**：用 `sed` 直接替换。把右边引号里的内容换成你自己的（密码只用字母数字）：

```bash
sed -i 's|^DOMAIN=.*|DOMAIN=movie.example.com|' .env
sed -i 's|^USERNAME=.*|USERNAME=admin|' .env
sed -i 's|^PASSWORD=.*|PASSWORD=MyStrongPass2026|' .env
cat .env
```

**方法 2：安装 nano 再编辑**

```bash
sudo apt-get update && sudo apt-get install -y nano   # CentOS/Rocky/Alma 用 sudo dnf install -y nano
nano .env
```

在 nano 里：用方向键移动光标改内容；保存按 `Ctrl + O` 再回车；退出按 `Ctrl + X`。

**方法 3：用系统自带的 vi**：`vi .env`，按 `i` 进入编辑，改完按 `Esc`，输入 `:wq` 回车保存退出（不想保存输入 `:q!`）。

以后要增删变量，都用上面任意一种方法改 `.env`。

**填写规则（很重要）：**

- `PASSWORD` **只用英文字母和数字**，至少 12 位。不要包含 `$`、`#`、空格、引号——这些字符在 `.env` 文件里有特殊含义，会导致密码和你以为的不一样。
- `DOMAIN` 只写域名本身，例如 `movie.example.com`，不要带 `https://` 和结尾的 `/`。
- 没有 `openssl` 命令的话，把 `$(openssl rand -hex 32)` 换成你自己生成的 32 位以上字母数字串。

改完后检查有没有漏改：

```bash
grep -E "请改成|example.com" .env || echo "OK：没有遗留的占位内容"
```

**应该看到** `OK：没有遗留的占位内容`。如果打印出了那几行，说明还有占位内容没改。

> 💡 **把 `.env` 里的 `AUTH_SECRET`、`PASSWORD` 另外保存到你的密码管理器里。** 丢了 `.env` 又没有备份，只能重新生成（登录状态会全部失效）。

---

#### 6. 创建 `docker-compose.yml`

这个文件告诉 Docker：要启动哪三个容器、它们怎么连接、用哪些配置。在 `PurpleMoon-main` 目录里，**整段复制**执行：

```bash
cat > docker-compose.yml <<'EOF'
services:
  # ---------- 本站程序 ----------
  purplemoon:
    build:
      context: .
      args:
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmjs.org}
    image: purplemoon:latest
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
      # 前面是 Caddy（1 层反向代理），用 X-Forwarded-For 识别真实访问者 IP
      - TRUST_X_FORWARDED_FOR=true
      - TRUSTED_PROXY_HOPS=1
    # 如需自定义资源站列表，取消下面三行的注释，并在本目录放一个修改过的 config.json
    # volumes:
    #   - ./config.json:/app/config.json:ro
    # 注意：这里故意没有 ports —— 本站程序只能被同一个 Compose 里的 Caddy 访问，不对公网开放

  # ---------- 数据库：保存用户、收藏、播放记录 ----------
  purplemoon-redis:
    image: redis:7-alpine
    container_name: purplemoon-redis
    restart: unless-stopped
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD:?请在 .env 中设置 REDIS_PASSWORD}
    command: ["sh", "-c", "exec redis-server --appendonly yes --requirepass \"$$REDIS_PASSWORD\""]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" --no-auth-warning ping | grep -q PONG"]
      interval: 10s
      timeout: 3s
      retries: 5

  # ---------- 门卫：HTTPS + 域名 ----------
  caddy:
    image: caddy:2
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
      - caddy-data:/data        # 保存 HTTPS 证书，请勿删除
      - caddy-config:/config

volumes:
  redis-data:
  caddy-data:
  caddy-config:
EOF
```

> ⚠️ 命令里的 `<<'EOF'`（EOF 两边有**单引号**）不能漏，否则里面的 `$$`、`${...}` 会被服务器的命令行提前替换掉，导致文件内容错误。

---

#### 7. 创建 `Caddyfile`

```bash
cat > Caddyfile <<'EOF'
{$DOMAIN} {
    encode gzip zstd
    reverse_proxy purplemoon:3000 {
        # 搜索结果是边查边返回的，关闭缓冲才能实时看到
        flush_interval -1
    }
}
EOF
```

这几行的意思：把访问 `DOMAIN` 的请求转交给名为 `purplemoon` 的容器的 3000 端口；HTTPS 证书 Caddy 会**自动申请和续期**，你不用做任何事。`reverse_proxy` 会自动带上 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For` 请求头，这正是本站登录 Cookie 和防跨站校验需要的。

---

#### 8. 检查配置、构建并启动

**8.1 检查配置文件有没有写错**

```bash
docker compose config -q && echo "配置文件格式正确"
```

**应该看到** `配置文件格式正确`。如果报错：

- 提示 `请在 .env 中设置 xxx`：说明 `.env` 里缺了这一项，回第 5 步补上。
- 提示 `yaml: ...` 或 `unknown ...`：说明 `docker-compose.yml` 被复制坏了，回第 6 步重新复制，注意不要漏掉开头或结尾。

**8.2 构建并启动（第一次需要 3～10 分钟）**

```bash
docker compose up -d --build
```

屏幕上会滚动大量文字，这是在下载基础镜像、安装依赖、编译网站，**请耐心等待，不要中断**。结束时应该看到类似：

```
 ✔ Container purplemoon-redis   Healthy
 ✔ Container purplemoon         Healthy
 ✔ Container purplemoon-caddy   Started
```

> 构建中途出现 `Killed`：内存不足，回第 3 步加虚拟内存后重试。
> 构建卡在 `pnpm install` 很久或报网络错误：在 `.env` 里取消 `NPM_REGISTRY=` 那行的注释（使用国内镜像），然后重新执行本命令。
> 下载基础镜像（`node`、`redis`、`caddy`）超时：这是服务器访问 Docker Hub 慢造成的，可以在云服务商控制台查找"Docker 镜像加速地址"并配置到 `/etc/docker/daemon.json` 的 `registry-mirrors` 里，然后 `sudo systemctl restart docker`。

**8.3 查看运行状态**

```bash
docker compose ps
```

**应该看到** 三个容器的 `STATUS` 都是 `Up ...`，其中前两个带有 `(healthy)`：

```
NAME                 STATUS
purplemoon           Up 1 minute (healthy)
purplemoon-caddy     Up 1 minute
purplemoon-redis     Up 1 minute (healthy)
```

如果 `purplemoon` 一直是 `starting`，等一分钟再看；如果是 `unhealthy` 或反复 `Restarting`，执行下面命令看错误原因：

```bash
docker compose logs --tail 50 purplemoon
```

**8.4 在服务器内部检查本站程序是否正常（还没用到域名）**

```bash
docker compose exec purplemoon wget -qO- http://127.0.0.1:3000/login | head -c 200
```

**应该看到**一小段以 `<!DOCTYPE html>` 开头的网页源码，说明程序本身没有问题。

---

#### 9. 用域名访问，并确认 HTTPS 生效

**9.1 看 Caddy 是否申请到证书**

```bash
docker compose logs --tail 30 caddy
```

**应该看到**包含 `certificate obtained successfully` 的日志行。如果看到反复出现 `challenge failed`、`timeout`、`no valid A records` 之类，请查看本章末尾的"常见问题"表中证书相关的几行。

**9.2 在浏览器打开**

在**你自己电脑的浏览器**输入 `https://你的域名`（例如 `https://movie.example.com`）。

**应该看到**：地址栏有小锁图标，并显示本站的登录页。第一次访问时可能还会弹出站点公告，点"我知道了"即可。

也可以在你自己的电脑上用命令检查：

```bash
curl -I https://movie.example.com
```

**应该看到** 第一行是 `HTTP/2 200`（或 `HTTP/2 307`，表示跳转到登录页，也正常）。

---

#### 10. 第一次登录与基本设置

1. 打开 `https://你的域名`，进入登录页。
2. 用户名填 `.env` 里的 `USERNAME`，密码填 `PASSWORD`，登录。这个账号就是**站长**。
3. 访问 `https://你的域名/admin` 进入后台，可以：管理用户、设置是否开放注册、调整资源站、给用户分组等。
4. **想让朋友也能注册**（登录页没有「注册」入口是正常的，要先开启）：
   1. **推荐：在后台开启。** 用站长账号登录，进入 `https://你的域名/admin`，在用户配置里打开「开放注册」开关并保存，**立即生效**，无需重启。
   2. **在后台创建邀请码**：同一页面的「邀请码」管理里添加邀请码（可设置使用次数、有效期、绑定分组），并按需打开「强制邀请码」开关；把邀请码发给朋友，注册时填写即可。邀请码**完全由后台管理**，不再通过环境变量配置。
   3. 之后登录页右侧（手机上在表单下方）会出现「注册」入口。
   - ⚠️ **为什么只改 `.env` 里的 `ENABLE_REGISTER` 可能没用？** 它只是「后台还没保存过设置时的初始默认值」。站长第一次进入后台或保存过设置后，「开放注册」的状态就存进了 Redis，此后**以后台开关为准**，`.env` 不再起作用。所以请到后台改。
   - 注册入口只在多用户（Redis）模式出现；精简版（localstorage）没有注册功能。
5. 建议在 `.env` 里**不要**把 `ENABLE_REGISTER` 长期设成 `true` 而不设邀请码——开放注册但没有邀请码，任何人都能注册使用你的服务器资源。

**恭喜，到这里你已经部署完成。** 下面是日常维护和遇到问题时的参考。

---

#### 添加其它环境变量（例如 `TMDB_API_TOKEN`）

分**两步**，缺一不可：

**第 1 步：在 `.env` 末尾加一行**（密钥放这里，不要写进 `docker-compose.yml`）：

```bash
echo 'TMDB_API_TOKEN=你的TMDB读访问令牌' >> .env
```

**第 2 步：在 `docker-compose.yml` 的 `purplemoon` 服务的 `environment:` 里加一行**，把 `.env` 的值传进容器。`.env` 只是给 Compose 自己读取的，**不会自动传进容器**，所以不加这一行等于没配置：

```bash
sed -i 's|^      - TRUSTED_PROXY_HOPS=1$|      - TRUSTED_PROXY_HOPS=1\n      - TMDB_API_TOKEN=${TMDB_API_TOKEN:-}|' docker-compose.yml
grep -n TMDB docker-compose.yml
```

（也可以用 nano/vi 打开 `docker-compose.yml`，在 `- TRUSTED_PROXY_HOPS=1` 下一行加 `      - TMDB_API_TOKEN=${TMDB_API_TOKEN:-}`，缩进必须与上一行对齐，用空格不要用 Tab。）

然后让配置生效，并确认容器里已经收到：

```bash
docker compose up -d
docker compose exec purplemoon sh -c 'test -n "$TMDB_API_TOKEN" && echo 已生效 || echo 未生效'
```

其它变量（`SITE_NAME`、`ANNOUNCEMENT`、`NEXT_PUBLIC_IMAGE_PROXY`、`TMDB_API_KEY` 等，完整列表见后面「环境变量」章节）都按同样两步添加：`.env` 写值 → `environment:` 加 `- 变量名=${变量名:-}`。
注意：`SITE_NAME`、`ANNOUNCEMENT` 等站点设置保存过后台后以后台为准。

#### 日常运维命令

以下命令都需要先 `cd ~/PurpleMoon-main`。

| 想做什么 | 命令 |
| -------- | ---- |
| 查看所有容器状态 | `docker compose ps` |
| 实时查看本站日志（`Ctrl + C` 退出） | `docker compose logs -f purplemoon` |
| 查看最近 100 行日志 | `docker compose logs --tail 100 purplemoon` |
| 重启本站 | `docker compose restart purplemoon` |
| 修改了 `.env` 之后使配置生效 | `docker compose up -d` |
| 停止全部服务（数据保留） | `docker compose stop` |
| 再次启动 | `docker compose start` |
| 停止并删除容器（**数据卷保留**） | `docker compose down` |
| 查看资源占用 | `docker stats --no-stream` |
| 清理旧的无用镜像，释放磁盘 | `docker image prune -f` |

> ⚠️ **千万不要执行 `docker compose down -v`**：多出来的 `-v` 会**同时删除数据卷**，也就是所有用户、收藏、播放记录和 HTTPS 证书。

服务器重启后，只要执行过第 1 步的 `systemctl enable docker`，并且容器设置了 `restart: unless-stopped`（本文的配置已设置），所有容器会自动恢复，不需要你做任何事。

#### 升级到新版本

1. **先备份**（见下一节）。
2. 在你自己的电脑上把新版压缩包上传到服务器：`scp PurpleMoon-新版本.zip root@服务器IP:~/`。
3. 在服务器上执行（把文件名换成实际的）：

```bash
cd ~
mkdir -p upgrade-tmp && unzip -q -o PurpleMoon-新版本.zip -d upgrade-tmp
cp -a upgrade-tmp/PurpleMoon-main/. PurpleMoon-main/
rm -rf upgrade-tmp
cd PurpleMoon-main
docker compose up -d --build
docker image prune -f
```

这样会用新代码覆盖旧代码，但**不会动你的 `.env`、`docker-compose.yml`、`Caddyfile`**（新压缩包里没有这三个文件），数据也保留在数据卷里。更新完成后用 `docker compose ps` 确认都是 `healthy`。

> 如果新版 README 的「更新记录」提示新增了必填环境变量，请先把它们补进 `.env`，并在 `docker-compose.yml` 的 `environment:` 里按相同格式加上一行。

#### 备份与恢复

需要备份三样东西：

| 备份对象 | 为什么 | 怎么备份 |
| -------- | ------ | -------- |
| `.env` | 里面有所有密钥与密码 | `cp .env ~/env-backup-$(date +%F)` 后下载到你自己的电脑 |
| Redis 数据卷 | 用户、收藏、播放记录、后台设置 | 见下 |
| `docker-compose.yml`、`Caddyfile` | 配置文件，丢了可以按本章重新生成 | 随手复制一份即可 |

备份 Redis 数据（先让它把数据写盘，再打包）：

```bash
docker compose exec purplemoon-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE'
sleep 3
docker run --rm -v purplemoon-main_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/redis-backup-$(date +%F).tgz -C /data .
ls -lh redis-backup-*.tgz
```

> 命令中的 `purplemoon-main_redis-data` 是"项目目录名 + 数据卷名"。如果你的目录名不是 `PurpleMoon-main`，用 `docker volume ls` 找到以 `_redis-data` 结尾的那一项替换。

把生成的 `redis-backup-日期.tgz` 下载到你自己的电脑保存：

```bash
# 在你自己的电脑上执行
scp root@服务器IP:~/PurpleMoon-main/redis-backup-*.tgz .
```

**恢复**：停掉服务，把备份解压回数据卷，再启动：

```bash
docker compose stop purplemoon purplemoon-redis
docker run --rm -v purplemoon-main_redis-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/redis-backup-日期.tgz -C /data"
docker compose start purplemoon-redis purplemoon
```

---

#### 路线 B：不用 Caddy，用服务器上的 Nginx + certbot

如果你的服务器上**已经在用 Nginx**，或者你更熟悉它，可以用这条路线。前面第 1～5 步完全相同，**从第 6 步开始有区别**：

**B-1. `docker-compose.yml` 做两处修改**

1. **删掉**整个 `caddy:` 服务，以及文件末尾 `volumes:` 里的 `caddy-data:` 和 `caddy-config:` 两行。
2. 给 `purplemoon:` 服务加上一个只对本机开放的端口映射（和 `restart:` 同一缩进层级）：

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

> ⚠️ 一定要写 `127.0.0.1:`。如果只写 `"3000:3000"`，Docker 会**绕过 `ufw` 防火墙**把 3000 端口直接暴露到公网，别人能跳过 Nginx 直接访问，也能伪造来源 IP 绕过限流。

`.env` 里的 `DOMAIN=` 在这条路线里只给 Nginx 配置用，保留即可。然后启动：

```bash
docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:3000/login
```

**应该看到** `HTTP/1.1 200 OK`。

**B-2. 安装 Nginx 和 certbot（Ubuntu / Debian）**

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

**B-3. 创建站点配置**（把 `movie.example.com` 换成你的域名，**两处一起换**，包括后面命令里的）：

```bash
sudo tee /etc/nginx/sites-available/purplemoon >/dev/null <<'EOF'
server {
    listen 80;
    server_name movie.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 用 $remote_addr 覆盖而不是追加，防止访问者伪造来源 IP
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 搜索结果是边查边返回的，关闭缓冲才能实时看到
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/purplemoon /etc/nginx/sites-enabled/purplemoon
sudo nginx -t
sudo systemctl reload nginx
```

**应该看到** `nginx: configuration file ... test is successful`。

**B-4. 申请 HTTPS 证书**

```bash
sudo certbot --nginx -d movie.example.com
```

按提示输入邮箱、同意条款；当问到是否把 HTTP 重定向到 HTTPS 时，选择 **2（Redirect）**。完成后 certbot 会自动修改 Nginx 配置并设置到期自动续期。

> `.env` 里 `TRUST_X_FORWARDED_FOR=true` 和 `TRUSTED_PROXY_HOPS=1` 在这条路线里同样正确：上面的 Nginx 配置把 `X-Forwarded-For` 覆盖为真实来源地址。

然后回到第 9 步，用浏览器访问 `https://你的域名`。

---

#### 路线 C：只想先在内网或本机试用（不要域名、不要 HTTPS）

如果你只是想先看看效果，可以不做域名、Caddy 和 Redis，直接单容器运行。**这种方式不要对公网开放。**

```bash
# 在项目根目录（含 Dockerfile 的目录）构建镜像，约需几分钟
docker build -t purplemoon:latest .

# 运行容器
# -d: 后台运行  -p: 映射端口 3000 -> 3000
# AUTH_SECRET 为必填项（至少 16 字符，建议 32 字符以上），缺失时服务将拒绝启动
docker run -d --name purplemoon -p 3000:3000 \
  -e PASSWORD=your_password \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  purplemoon:latest
```

访问 `http://服务器IP:3000`（需在安全组放通 3000 端口，试用完请关闭）。这是 localstorage 模式：只有一个访问密码、没有多用户，收藏和播放记录只保存在每个人自己的浏览器里。

删除试用容器：`docker rm -f purplemoon`。

#### 附：只有你一个人用的精简版（无 Redis）

不需要多用户和跨设备同步时，可以去掉 Redis。第 5 步的 `.env` 里只需要 `DOMAIN`、`PASSWORD`、`AUTH_SECRET`、`CRON_SECRET` 四项；第 6 步的 `docker-compose.yml` 换成下面这个：

```yaml
services:
  purplemoon:
    build:
      context: .
      args:
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmjs.org}
    image: purplemoon:latest
    container_name: purplemoon
    restart: unless-stopped
    environment:
      - PASSWORD=${PASSWORD:?请在 .env 中设置 PASSWORD}
      - AUTH_SECRET=${AUTH_SECRET:?请在 .env 中设置 AUTH_SECRET}
      - CRON_SECRET=${CRON_SECRET:?请在 .env 中设置 CRON_SECRET}
      - TRUST_X_FORWARDED_FOR=true
      - TRUSTED_PROXY_HOPS=1

  caddy:
    image: caddy:2
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
      - caddy-data:/data
      - caddy-config:/config

volumes:
  caddy-data:
  caddy-config:
```

其余步骤（第 7～10 步）完全相同。此模式下登录页只有一个密码框，输入 `PASSWORD` 即可，没有 `/admin` 后台。

#### 可选：推送到你自己的镜像仓库

如果你有多台服务器，可以在一台机器构建后推到自己的仓库，其他机器直接拉取：

```bash
echo $GHCR_TOKEN | docker login ghcr.io -u <你的用户名> --password-stdin
docker tag purplemoon:latest ghcr.io/<你的用户名>/purplemoon:latest
docker push ghcr.io/<你的用户名>/purplemoon:latest
# 推送后到 GitHub → Packages → 该包 → Package settings 将可见性改为 Public，或在服务器上先 docker login
```

---

#### 常见问题排查

| 现象 | 可能原因 | 解决办法 |
| ---- | -------- | -------- |
| `docker compose up` 提示 `请在 .env 中设置 xxx` | `.env` 缺少这一项，或不在 `docker-compose.yml` 同一目录 | 回第 5 步补上；确认执行命令时位于 `PurpleMoon-main` 目录 |
| 构建时 `Killed` | 内存不足 | 第 3 步添加虚拟内存后重试 |
| 构建卡在 `pnpm install` 或网络超时 | 访问 npm 官方源太慢 | `.env` 里启用 `NPM_REGISTRY=https://registry.npmmirror.com` 后重新 `docker compose up -d --build` |
| `purplemoon` 容器一直 `Restarting` | 常见是 `AUTH_SECRET` 缺失或少于 16 个字符 | `docker compose logs --tail 50 purplemoon`；日志里出现"启动失败：未配置 AUTH_SECRET"就检查 `.env` |
| 容器 `unhealthy` | 程序启动出错 | 同上，先看日志 |
| 浏览器显示"无法访问此网站" | 域名没解析到本机，或 80/443 没放行 | 第 4 步：`nslookup` 检查解析；安全组和 `ufw` 都要放行 |
| 浏览器提示证书错误 / `ERR_SSL_PROTOCOL_ERROR` | Caddy 还没申请到证书 | `docker compose logs caddy`；确认解析已生效、80 端口可从公网访问；Cloudflare 用户先关闭橙色云朵 |
| Caddy 日志反复 `challenge failed`、`timeout during connect` | 公网访问不到你的 80 端口 | 检查云安全组、服务器防火墙、是否有备案限制 |
| Caddy 日志 `no valid A records` | 域名解析还没生效，或 `.env` 的 `DOMAIN` 写错 | 等解析生效；`grep DOMAIN .env` 检查 |
| 80 或 443 端口被占用，`caddy` 起不来 | 服务器上已有 Nginx/Apache | `sudo ss -tlnp \| grep -E ':80 \|:443 '` 查占用；停掉它，或改用路线 B |
| 访问提示 502 Bad Gateway | 本站程序没起来或还在启动 | `docker compose ps` 看是否 `healthy`；`docker compose logs purplemoon` |
| 登录后又回到登录页 | Cookie 没写成功，常见于用 `http://` 访问，或代理没传 `X-Forwarded-Proto` | 用 `https://域名` 访问；用路线 A 就不需要额外设置；路线 B 确认 Nginx 配置里有 `X-Forwarded-Proto` 那一行 |
| 点保存、收藏等操作返回 403 | 代理没传 `Host`，防跨站校验失败 | 路线 B 确认 `proxy_set_header Host $host;` 存在 |
| 提示"尝试登录过于频繁" | 触发了登录限流 | 等 1 分钟（同一 IP）或 15 分钟（同一账号）后再试；不要反复输错密码 |
| 改了 `.env` 没效果 | ① 没有重新创建容器；② 新增的变量没写进 `docker-compose.yml` 的 `environment:` | ① `docker compose up -d`（不是 `restart`）；② 见「添加其它环境变量」 |
| 登录页没有「注册」入口 | 后台开关未开（后台设置优先于 `.env`） | 站长登录 `/admin`，打开「开放注册」 |
| `nano: command not found` | 服务器没装 nano | 第 5 步的 `sed` 方法，或 `sudo apt-get install -y nano` |
| 磁盘越来越满 | 旧镜像和构建缓存累积 | `docker image prune -f`；`docker builder prune -f` |
| 忘记站长密码 | — | 改 `.env` 里的 `PASSWORD`，然后 `docker compose up -d` |

如果以上都不能解决，请收集下面三段输出，再向别人求助（**发出去之前把里面的密码、密钥抹掉**）：

```bash
docker compose ps
docker compose logs --tail 100 purplemoon
docker compose logs --tail 50 caddy
```

#### 安全检查清单

- [ ] 只对公网开放了 `22`、`80`、`443`（路线 B 还要确认 `3000` 没有对公网开放：`sudo ss -tlnp | grep 3000` 应显示 `127.0.0.1:3000`）。
- [ ] `PASSWORD` 足够长且只在你自己手里；`.env` 权限为 `600`，没有上传到任何公开仓库。
- [ ] Redis 没有映射任何端口到公网（本文的配置没有）。
- [ ] SSH 建议改为密钥登录并禁用密码登录；服务器系统定期更新（`sudo apt-get update && sudo apt-get upgrade -y`）。
- [ ] 已经备份了 `.env` 和 Redis 数据，并知道怎么恢复。
- [ ] 需要开放注册时，已在后台创建邀请码并开启「强制邀请码」。

---

## 环境变量

### 必填与核心

| 变量 | 说明 | 可选值 | 默认值 |
| ---- | ---- | ------ | ------ |
| `AUTH_SECRET` | **必填**。用于签名登录 Cookie；缺失或少于 16 字符时，生产环境服务拒绝启动。轮换它会让所有已登录会话失效 | 建议 32 位以上随机字符串（`openssl rand -hex 32`） | 空 |
| `PASSWORD` | 默认部署时为唯一访问密码，数据库模式时为站长密码。**不设置则整站免登录** | 任意字符串 | 空 |
| `USERNAME` | 数据库模式（redis / d1 / upstash）下的站长账号 | 任意字符串 | 空 |
| `CRON_SECRET` | `/api/cron` 的 Bearer 密钥。**未设置时 cron 接口一律返回 401**（不会刷新收藏/播放记录的集数）。Docker 内置定时器和 Vercel Cron 都会自动带上它 | 任意 32 位以上字符串 | 空 |

### 存储

| 变量 | 说明 | 可选值 | 默认值 |
| ---- | ---- | ------ | ------ |
| `NEXT_PUBLIC_STORAGE_TYPE` | 播放记录/收藏的存储方式 | localstorage、redis、d1、upstash | localstorage |
| `REDIS_URL` | redis 连接 url，`NEXT_PUBLIC_STORAGE_TYPE` 为 redis 时必填 | 连接 url | 空 |
| `UPSTASH_URL` | upstash redis 连接 url | 连接 url | 空 |
| `UPSTASH_TOKEN` | upstash redis 连接 token | 连接 token | 空 |

### 注册与邀请

| 变量 | 说明 | 可选值 | 默认值 |
| ---- | ---- | ------ | ------ |
| `NEXT_PUBLIC_ENABLE_REGISTER` | 是否开放注册，仅在非 localstorage 部署时生效 | true / false | false |
| `TURNSTILE_DISABLED` | Cloudflare Turnstile 应急开关。后台把 Secret Key 填错会让包括站长在内的所有人无法登录，此时设为 true 并重启即可强制关闭人机验证（优先级高于后台设置），修正密钥后再去掉该变量 | true / false | 空 |

> 邀请码及其开关完全由**管理后台**管理（后台 → 邀请码），不再读取 `VALID_INVITE_CODE` / `REQUIRE_INVITE_CODE` 环境变量。后台尚未保存过邀请码设置时，开放注册默认强制邀请码；此时若后台没有任何邀请码，注册会提示联系站长。

### 站点与功能

| 变量 | 说明 | 可选值 | 默认值 |
| ---- | ---- | ------ | ------ |
| `SITE_NAME` | 站点名称 | 任意字符串 | purplemoon |
| `ANNOUNCEMENT` | 站点公告 | 任意字符串 | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | 搜索接口可拉取的最大页数 | 1-50 | 5 |
| `NEXT_PUBLIC_IMAGE_PROXY` | 默认的浏览器端图片代理 | `https://timis.dpdns.org/?url=` | 空 |
| `NEXT_PUBLIC_AD_FINGERPRINTS` | 额外的广告“分片时长指纹”（构建时注入；也可在播放页控制台用 `__adLearn(开始秒, 结束秒)` 自助记录） | 多支用 `;` 分隔，同一支的分片时长（秒）用逗号分隔，如 `5.567,2.933,5.7,3.333,1.533` | 空 |
| `TMDB_API_TOKEN` | 上映日程 TMDB 令牌 | API 读访问令牌 | 空 |
| `TMDB_API_KEY` | TMDB v3 API Key（与 `TMDB_API_TOKEN` 二选一，用于“最近上映”） | API Key | 空 |
| `TMDB_BASE_URL` | TMDB API 地址（自建反代时修改） | URL | https://api.themoviedb.org/3 |

### 安全与客户端 IP

这几项的原理、取舍和示例见「[部署与 IP 识别](#部署与-ip-识别)」。

| 变量 | 说明 | 可选值 | 默认值 |
| ---- | ---- | ------ | ------ |
| `TRUST_CF_CONNECTING_IP` | 设为 true 才会信任 `CF-Connecting-IP` 头。仅当站点部署在 Cloudflare 且源站只接受 Cloudflare 回源时开启 | true | 空 |
| `TRUST_X_REAL_IP` | 设为 true 才会信任 `X-Real-IP` 头。仅当前置反向代理会用真实连接地址覆盖该头时开启 | true | 空 |
| `TRUST_X_FORWARDED_FOR` | 设为 true 才会信任 `X-Forwarded-For` 头，并取**倒数第 N 个**地址（N 见 `TRUSTED_PROXY_HOPS`）。仅当前置代理会追加真实来源地址时开启 | true | 空 |
| `TRUSTED_PROXY_HOPS` | `X-Forwarded-For` 链上你自己控制的代理层数，取倒数第 N 个 | 1-5 | 1 |
| `COOKIE_SECURE` | 显式控制登录 Cookie 是否带 `Secure`。默认：生产环境下仅当请求实际经由 HTTPS（`X-Forwarded-Proto: https`）时才加。通过 `http://IP:3000` 直连时请保持默认或设为 false，否则浏览器会丢弃 Cookie 导致“登录后立即回到登录页” | true / false | 空（自动） |

## 不同部署环境的变量配置

上面的表格是“所有变量的含义”，这一节说明**在 Docker、Vercel、Cloudflare Pages 上分别要配哪些**。

图例：✅ 必填 · 🔶 按条件必填/强烈建议 · ⭕ 可选 · ➖ 不需要（或不可用）

### 变量速查表

| 变量 | Docker | Vercel | Cloudflare Pages | 备注 |
| ---- | :----: | :----: | :--------------: | ---- |
| `AUTH_SECRET` | ✅ | ✅ | ✅（密钥） | 三个平台都必填。缺失时 Docker 启动即报错，Vercel / Cloudflare 上所有登录请求会失败 |
| `PASSWORD` | ✅ | ✅ | ✅（密钥） | localstorage 模式 = 全站唯一访问密码；数据库模式 = 站长密码。**不设置则整站免登录** |
| `USERNAME` | 🔶 | 🔶 | 🔶 | 仅数据库模式（redis / d1 / upstash）需要，作为站长账号；localstorage 模式不用 |
| `NEXT_PUBLIC_STORAGE_TYPE` | 🔶 | 🔶 | 🔶 | 不设 = localstorage。Docker：`redis` 或 `upstash`；Vercel：`upstash`；Cloudflare：`d1` 或 `upstash` |
| `REDIS_URL` | 🔶（redis） | ➖ | ➖ | 原生 Redis 走 TCP，Vercel / Cloudflare 的 Edge 运行时不支持 |
| `UPSTASH_URL` `UPSTASH_TOKEN` | 🔶（upstash） | 🔶（upstash） | 🔶（upstash） | 走 HTTPS，三个平台都能用 |
| D1 数据库**绑定** `DB` | ➖ | ➖ | 🔶（d1） | 不是环境变量：在 **设置 → 绑定** 里添加 D1，变量名必须是 `DB` |
| `NEXT_PUBLIC_ENABLE_REGISTER` | ⭕ | ⭕ | ⭕ | 仅数据库模式生效 |
| `CRON_SECRET` | 🔶 | 🔶 | 🔶 | 见下方“定时任务” |
| `SITE_NAME` `ANNOUNCEMENT` | ⭕ | ⭕ | ⭕ | 见下方“站点设置的优先级” |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` `NEXT_PUBLIC_IMAGE_PROXY` | ⭕ | ⭕ | ⭕ | `NEXT_PUBLIC_*` 在构建时写入，**修改后 Vercel / Cloudflare 需重新部署** |
| `TMDB_API_TOKEN` 或 `TMDB_API_KEY` | ⭕ | ⭕ | ⭕ | 不设则“最近上映”页面报错 |
| `TRUST_CF_CONNECTING_IP` | 🔶（经 Cloudflare 时） | ➖ | ✅ 设为 `true` | 用于登录/注册/搜索限流识别真实 IP |
| `TRUST_X_FORWARDED_FOR` `TRUSTED_PROXY_HOPS` | 🔶（经反向代理时） | ➖ | ➖ | Vercel 平台已自行覆盖 `X-Forwarded-For`，无需设置 |
| `TRUST_X_REAL_IP` | ⭕ | ➖ | ➖ | 仅当 Nginx 用 `$remote_addr` 覆盖了 `X-Real-IP` |
| `COOKIE_SECURE` | ⭕ | ➖ | ➖ | 仅 Docker 用 http 直连测试时才需要，见下 |
| `DOCKER_ENV` `HOSTNAME` `PORT` | 镜像已内置，**不要改** | ➖ **不要设置** | ➖ **不要设置** | 在 Vercel / Cloudflare 设置 `DOCKER_ENV=true` 会导致配置加载异常 |

### Docker

环境变量在**运行时**读取，改完 `docker compose up -d` 重建容器即可，不需要重新构建镜像。`config.json` 也是运行时读取（可挂载）。

最小 localstorage：

```yaml
environment:
  - PASSWORD=强密码
  - AUTH_SECRET=openssl rand -hex 32 的输出
```

推荐 Redis 版（放在 Nginx / Caddy 之后，对外 HTTPS）：

```yaml
environment:
  - USERNAME=站长账号
  - PASSWORD=站长密码
  - AUTH_SECRET=openssl rand -hex 32 的输出
  - CRON_SECRET=openssl rand -hex 32 的输出   # 容器内置定时器会自动带上，每小时刷新一次
  - NEXT_PUBLIC_STORAGE_TYPE=redis
  - REDIS_URL=redis://purplemoon-redis:6379
  - NEXT_PUBLIC_ENABLE_REGISTER=true
  - TRUST_X_FORWARDED_FOR=true               # 前置的是会追加 X-Forwarded-For 的反向代理
  - TRUSTED_PROXY_HOPS=1                     # 反向代理层数；Cloudflare → Nginx → 应用 填 2
```

- **HTTPS / Cookie**：Cookie 只有在请求经 HTTPS（`X-Forwarded-Proto: https`）时才带 `Secure`。反向代理必须传 `Host` 和 `X-Forwarded-Proto`，否则写操作会因 CSRF 校验失败返回 403。
- **用 `http://IP:3000` 直连测试**：保持默认即可正常登录；不要把 `COOKIE_SECURE` 设成 `true`。
- **前面是 Cloudflare 再接 Nginx**：用 `TRUST_CF_CONNECTING_IP=true`（并让源站只接受 Cloudflare 回源），或者 `TRUST_X_FORWARDED_FOR=true` + `TRUSTED_PROXY_HOPS=2`。
- **源站必须只接受代理流量**（防火墙不要放行 3000 端口给公网），否则客户端可绕过代理伪造请求头规避限流。
- **多个容器副本**：登录 / 注册 / 便签限流走共享的 Redis；`/api/search` 的限流仍是每个实例自己的内存，需要时在代理层再加一层限流。

### Vercel

在 **Project → Settings → Environment Variables** 添加，Environment 勾选 Production。**改完变量必须重新部署**（`NEXT_PUBLIC_*` 是构建时写入的）。

最小配置（Upstash）：

```
AUTH_SECRET=openssl rand -hex 32 的输出
USERNAME=站长账号
PASSWORD=站长密码
NEXT_PUBLIC_STORAGE_TYPE=upstash
UPSTASH_URL=https://xxx.upstash.io
UPSTASH_TOKEN=xxx
CRON_SECRET=openssl rand -hex 32 的输出
NEXT_PUBLIC_ENABLE_REGISTER=true    # 开放注册时
```

- **不能用 `REDIS_URL`**：Vercel 不支持原生 Redis，用 Upstash。
- **定时任务**：仓库自带 `vercel.json`，每天 01:00 UTC 调用 `/api/cron`。设置了 `CRON_SECRET` 后，Vercel 会自动带上 `Authorization: Bearer <CRON_SECRET>`，**不设置则 cron 一律 401**。
- **真实 IP**：Vercel 会覆盖 `X-Forwarded-For`，不需要设置任何 `TRUST_*`，默认即可正确限流。
- **不要设置** `DOCKER_ENV`、`COOKIE_SECURE`。
- **改 `config.json`**（资源站列表）需提交到仓库触发重新构建。

### Cloudflare Pages

在 **设置 → 变量和机密** 添加。敏感值用**密钥（Secret）**：`AUTH_SECRET`、`PASSWORD`、`CRON_SECRET`、`UPSTASH_TOKEN`、`TMDB_API_TOKEN`；`NEXT_PUBLIC_*`、`USERNAME`、`TRUST_*` 等非敏感值用文本变量。同样**改完需重新部署**，且兼容性标志要设为 `nodejs_compat`。

D1 版：

```
AUTH_SECRET=openssl rand -hex 32 的输出        （密钥）
USERNAME=站长账号
PASSWORD=站长密码                              （密钥）
NEXT_PUBLIC_STORAGE_TYPE=d1
TRUST_CF_CONNECTING_IP=true
CRON_SECRET=openssl rand -hex 32 的输出        （密钥）
NEXT_PUBLIC_ENABLE_REGISTER=true               （开放注册时）
```

另外在 **设置 → 绑定** 添加 D1 数据库，变量名填 `DB`（不是环境变量）。Upstash 版把 `NEXT_PUBLIC_STORAGE_TYPE` 换成 `upstash` 并加 `UPSTASH_URL`、`UPSTASH_TOKEN`，不需要 D1 绑定。

- **真实 IP**：必须设 `TRUST_CF_CONNECTING_IP=true`，否则取不到真实客户端 IP。
- **定时任务**：Pages 本身没有 Cron，仓库里的 `vercel.json` 在 Cloudflare 上无效。需要刷新收藏/播放记录集数时，用 Cloudflare Worker 的 Cron Trigger 或任意外部定时服务，定时 `GET https://你的域名/api/cron`，请求头带 `Authorization: Bearer <CRON_SECRET>`；不需要这个功能可以不设。
- **不能用 `REDIS_URL`**：Cloudflare 不支持原生 Redis。

### 站点设置的优先级

| 部署方式 | `SITE_NAME` / `ANNOUNCEMENT` / `NEXT_PUBLIC_ENABLE_REGISTER` / `NEXT_PUBLIC_IMAGE_PROXY` |
| -------- | ---- |
| Docker + 数据库 | 仅在**首次初始化**时作为默认值写入数据库，之后以后台 `/admin` 的修改为准 |
| Vercel / Cloudflare + 数据库 | **每次请求都以环境变量为准**，后台修改这几项（如注册开关）不会持久生效，要改请改环境变量并重新部署 |
| localstorage | 始终以环境变量为准，没有后台 |

## 部署与 IP 识别

登录、注册、便签等接口按“来源 IP”限流，其中登录还按“账号 + IP”计数。程序取到的 IP 对不对，直接决定限流有没有用：

- 取成代理自己的地址：所有用户共用一个计数桶，一个人就能把大家的限流用光。
- 取到了客户端自己写的值：攻击者每次换一个值就能换桶，绕过“账号 + IP”限制，只剩账号级上限在保护。

请求头（`X-Forwarded-For`、`X-Real-IP`、`CF-Connecting-IP`）都是普通头，只有**你自己控制的代理**写进去的值才可信。`TRUST_*` 变量就是让你声明“哪个头可信”。

### 取 IP 的顺序

| 步骤 | 来源 | 何时使用 |
| :--: | ---- | -------- |
| 1 | 运行平台直接提供的连接地址 | 有就用，客户端无法伪造 |
| 2 | `CF-Connecting-IP` | 仅当 `TRUST_CF_CONNECTING_IP=true` |
| 3 | `X-Real-IP` | 仅当 `TRUST_X_REAL_IP=true` |
| 4 | `X-Forwarded-For` 倒数第 N 个 | 仅当 `TRUST_X_FORWARDED_FOR=true`，N 由 `TRUSTED_PROXY_HOPS` 决定（默认 1） |
| 5 | `X-Forwarded-For` 最右侧一项 | 兜底：没有任何 `TRUST_*` 命中时使用 |
| 6 | `unknown_ip` | 以上都没有时 |

开关只认字符串 `true`（不区分大小写）；写成 `1`、`yes` 无效。开发环境（非 production）不受此限制，没有来源信息时回落到 `127.0.0.1`。

### 三个开关

**`TRUST_CF_CONNECTING_IP=true`**

站点在 Cloudflare 后面时使用。前提：源站防火墙只放行 Cloudflare 的 IP 段，否则别人绕过 Cloudflare 直连源站，就能自己写这个头。

**`TRUST_X_REAL_IP=true`**

前面有 Nginx 等代理，并且它会用真实连接地址覆盖 `X-Real-IP`（Nginx：`proxy_set_header X-Real-IP $remote_addr;`），不能透传客户端自带的值。

**`TRUST_X_FORWARDED_FOR=true` + `TRUSTED_PROXY_HOPS=N`**

代理会把真实来源追加到 `X-Forwarded-For` 末尾。程序取倒数第 N 个，因为最左边的值客户端可以随便写，右边才是你自己的代理加的。N 等于你控制的代理层数：

- 只有 1 层 Nginx：`TRUSTED_PROXY_HOPS=1`。
- Cloudflare → Nginx → 应用：Nginx 追加的是 Cloudflare 的 IP，真实用户在倒数第 2 个，填 `2`；这种情况更推荐直接用 `TRUST_CF_CONNECTING_IP`。

### 配置示例

**示例 1：Cloudflare 直连源站（含 Cloudflare Pages）**

```
TRUST_CF_CONNECTING_IP=true
```

自建源站时，再在防火墙里只放行 Cloudflare 的 IP 段访问 80/443。Cloudflare Pages 上必须设置，否则取不到真实客户端 IP。

**示例 2：Docker + Nginx 反向代理（最常见）**

Nginx：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # 覆盖，而不是 $proxy_add_x_forwarded_for
}
```

应用：

```
TRUST_X_REAL_IP=true
```

Docker Compose：

```yaml
services:
  purplemoon:
    environment:
      - TRUST_X_REAL_IP=true
```

`Host` 和 `X-Forwarded-Proto` 也必须传，否则写操作会因 CSRF 校验失败返回 403。

**示例 3：Nginx 保留 `$proxy_add_x_forwarded_for`**

```
TRUST_X_FORWARDED_FOR=true
TRUSTED_PROXY_HOPS=1
```

此时链为 `客户端伪造值, 真实IP`，取倒数第 1 个即真实 IP。

**示例 4：Cloudflare → Nginx → 应用**

```
TRUST_CF_CONNECTING_IP=true
```

最简单，不用计算跳数；前提同样是源站只接受 Cloudflare 回源。

**示例 5：Vercel**

Vercel 会覆盖 `X-Forwarded-For`，默认的兜底规则（取最右侧一项）即可得到真实来源，不需要设置任何 `TRUST_*`。

### 不配置或配错的后果

| 情况 | 结果 |
| ---- | ---- |
| 一个都不配，站点在代理后面 | 走兜底：取 `X-Forwarded-For` 最右侧一项，通常就是代理看到的真实来源，一般可用 |
| 一个都不配，直接暴露公网 | 最右侧一项由客户端自己写，攻击者可换桶；没有该头时所有请求落入 `unknown_ip`。两种情况下账号级上限都仍然生效，不会无限试密码 |
| 开启了开关，但代理没有覆盖对应头 | 攻击者伪造该头即可每次换一个 IP，绕过“账号 + IP”限制，只剩账号级上限保护 |
| `TRUSTED_PROXY_HOPS` 偏大 | 取到更靠左的、可被伪造的值 |
| `TRUSTED_PROXY_HOPS` 偏小 | 取到代理自己的 IP，所有用户共用一个桶 |

账号级上限（localstorage 60 次、数据库 200 次，每 15 分钟）被打满时，该账号在窗口内无法登录，包括站长账号。这是防止暴力破解的代价，请务必让服务只接受反向代理的流量，并配置好 `TRUST_*`，不要依赖兜底。

### 如何验证配置正确

程序没有提供显示“识别到的 IP”的接口，可以这样临时验证：

1. 在 `src/app/api/login/route.ts` 的 `POST` 里临时加一行 `console.log('client ip:', getClientIp(req))`，部署到测试环境。
2. 分别用手机流量和家里宽带各登录一次，日志里应当是各自的公网 IP，而不是 `127.0.0.1`、内网地址或 `unknown_ip`。
3. 再用 `curl -H 'X-Forwarded-For: 1.2.3.4' ...` 自己伪造一次，日志里仍应是你的真实 IP；如果变成了 `1.2.3.4`，说明信任范围配得太宽。
4. 验证完毕，删掉那行日志。

## 配置说明

所有可自定义项集中在根目录的 `config.json` 中：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
      "name": "电影天堂资源",
      "detail": "http://caiji.dyttzyapi.com"
    }
    // ...更多站点
  }
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。

PurpleMoon 支持标准的苹果 CMS V10 API 格式。

修改后 **无需重新构建**，服务会在启动时读取一次。

## 管理员配置

**该特性目前仅支持通过非 localstorage 存储的部署方式使用**

支持在运行时动态变更服务配置

设置环境变量 USERNAME 和 PASSWORD 即为站长用户，站长可设置用户为管理员

站长或管理员访问 `/admin` 即可进行管理员配置

## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

暂时收藏夹与播放记录和网页端隔离，后续会支持同步用户数据

## 更新记录

- 更新说明见PM更新日志

## Roadmap

- [x] 深色模式
- [x] 持久化存储
- [x] 多账户

## License

[MIT](LICENSE) © 2026 PurpleMoon & Contributors 


## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [MoonTV](https://github.com/samqin123/MoonTV) — 基于此二次开发。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- 感谢所有提供免费影视接口的站点。
