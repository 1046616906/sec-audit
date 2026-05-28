# Docker 部署指南

## 服务器要求

- 内存：≥4GB
- Docker：≥20.10
- Docker Compose：≥2.0

## 一键部署（推荐）

```bash
# 1. 克隆或上传代码到服务器
git clone <your-repo-url>
cd security-audit

# 2. 运行部署脚本
./deploy.sh
```

脚本会自动：
- 检查 Docker 环境
- 创建环境变量模板
- 构建镜像
- 启动服务
- 初始化数据库

## 手动部署

### 1. 准备环境变量

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`，填入你的 LLM API 配置：

```bash
# Redis 连接（Docker 内部网络）
REDIS_URL=redis://redis:6379

# LLM API 配置（必填）
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://your-api-endpoint/v1
AI_MODEL=claude-sonnet-4-6

# 数据库（生产环境使用容器内路径）
DATABASE_URL=file:/app/prisma/prod.db
```

### 2. 构建并启动服务

```bash
# 构建镜像（首次部署或代码更新后执行）
docker compose build

# 启动所有服务
docker compose up -d

# 查看日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f web
docker compose logs -f worker
```

### 3. 初始化数据库

首次部署需要初始化数据库：

```bash
docker compose exec web pnpm prisma db push
```

### 4. 访问应用

浏览器打开：`http://your-server-ip:3000`

## 常用命令

```bash
# 停止服务
docker compose down

# 停止并删除数据卷（⚠️ 会删除所有数据）
docker compose down -v

# 重启服务
docker compose restart

# 查看运行状态
docker compose ps

# 进入容器调试
docker compose exec web sh
docker compose exec worker sh

# 查看资源占用
docker stats
```

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建镜像
docker compose build

# 重启服务
docker compose up -d

# 如果数据库 schema 有变化，执行迁移
docker compose exec web pnpm prisma db push
```

## 数据持久化

以下数据会持久化到 Docker volumes：

- `redis_data`：Redis 数据
- `db_data`：SQLite 数据库文件

查看数据卷：
```bash
docker volume ls | grep security-audit
```

备份数据库：
```bash
docker compose exec web cat /app/prisma/prod.db > backup-$(date +%Y%m%d).db
```

## 内存优化（4GB 服务器）

当前配置已针对 4GB 内存优化：

- **镜像优化**：
  - Web 镜像：node:20-alpine (~180MB）
  - Worker 镜像：node:20-alpine + 系统 Chromium (~350MB）
  - Redis 镜像：redis:7-alpine (~30MB）
  
- **Worker 并发数**：2（在 `worker/index.ts` 中配置）
- **Chromium 实例**：最多 2 个同时运行
- **预估内存占用**：
  - Redis：~50MB
  - Web 服务：~200MB
  - Worker 基础：~150MB
  - 每个 Chromium 实例：~300-400MB（Alpine 系统 Chromium 更轻量）
  - **总计**：~1.2-1.8GB（峰值）

### 降低并发数（如果内存不足）

编辑 `worker/index.ts` 第 134 行：

```typescript
const worker = new Worker<ScanJobData>("scan-queue", processScan, {
  connection: redis,
  concurrency: 1, // 改为 1，内存占用降至 ~1GB
});
```

修改后需要重新构建：
```bash
docker compose build worker
docker compose up -d worker
```

### 监控内存使用

```bash
# 实时查看容器资源占用
docker stats

# 查看系统内存
free -h
```

## 故障排查

### 服务无法启动

```bash
# 查看详细日志
docker compose logs

# 检查端口占用
netstat -tlnp | grep 3000

# 检查磁盘空间
df -h
```

### Chromium 启动失败

Worker 容器已包含所有必需的系统依赖。如果仍然失败：

```bash
# 进入 worker 容器测试
docker compose exec worker sh
npx playwright install chromium
```

### 数据库连接错误

确保 `DATABASE_URL` 指向容器内路径：
```
DATABASE_URL=file:/app/prisma/prod.db
```

### Redis 连接错误

确保 `REDIS_HOST=redis`（使用 Docker 内部网络名称）

## 安全建议

1. **不要将 `.env.production` 提交到 git**
2. **定期备份数据库**
3. **使用反向代理（Nginx）添加 HTTPS**
4. **限制 3000 端口仅内网访问**

示例 Nginx 配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # SSE 支持
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```
