# Sec-Agent-Workspace

内部 Web 敏感信息扫描与智能审计系统。基于 Playwright + 大模型 Function Calling，自动发现并判定业务系统中的敏感数据泄漏风险。

---

## 技术栈

- **前端**: Next.js 16 (App Router) · React 19 · Tailwind CSS · Framer Motion · Zustand
- **后端**: Next.js Route Handlers · BullMQ · ioredis · Prisma + SQLite
- **扫描引擎**: Playwright (独立 Worker 进程) · Vercel AI SDK (Function Calling)

---

## 本地开发

### 前置要求

- Node.js 18+
- pnpm
- Redis

```bash
# macOS
brew install redis && brew services start redis

# 或 Docker 启动 Redis
docker run -d -p 6379:6379 redis:7-alpine
```

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

```bash
cp .env.production.example .env.local
```

编辑 `.env.local`：

```env
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://your-api-endpoint/v1
AI_MODEL=claude-sonnet-4-6
DATABASE_URL=file:./prisma/dev.db
```

### 初始化数据库

```bash
pnpx prisma db push
```

### 启动

需要两个终端：

```bash
# 终端 1 — Next.js 前端
pnpm dev

# 终端 2 — BullMQ Worker（扫描引擎）
pnpm worker
```

访问 [http://localhost:3000](http://localhost:3000)

---

## Docker 部署（推荐用于服务器）

### 前置要求

- Docker
- Docker Compose

### 配置环境变量

```bash
cp .env.production.example .env.production
```

编辑 `.env.production` 填入实际值（`REDIS_URL` 保持 `redis://redis:6379` 不变）。

### 构建镜像

```bash
docker compose build
```

### 初始化数据库（首次部署执行一次）

```bash
docker-compose run worker pnpx prisma db push
```

### 启动所有服务

```bash
docker compose up -d
```

访问 `http://your-server-ip:3000`

### 常用命令

```bash
# 查看日志
docker compose logs -f

# 仅查看 Worker 日志
docker compose logs -f worker

# 停止服务
docker compose down

# 重启 Worker
docker compose restart worker
```

---

## 传输到服务器

**方式一：rsync（推荐）**

```bash
rsync -av --exclude='node_modules' --exclude='.next' --exclude='prisma/dev.db' \
  ./ root@your-server:/opt/sec-agent/
```

**方式二：打包传输**

```bash
# 本地打包（注意：不要提交压缩包到 git）
tar --exclude='node_modules' --exclude='.next' --exclude='prisma/dev.db' \
  -czf /tmp/sec-agent.tar.gz .

# 上传
scp /tmp/sec-agent.tar.gz root@your-server:/opt/sec-agent/

# 服务器解压
ssh root@your-server "cd /opt/sec-agent && tar -xzf sec-agent.tar.gz"
```

服务器上再执行 Docker 部署步骤即可。

---

## 验证命令

```bash
pnpm dev             # 启动开发服务器
pnpm build           # 生产构建
pnpm check:types     # TypeScript 类型检查
pnpm lint            # ESLint 检查
pnpx prisma db push  # 推送数据库 Schema
```
