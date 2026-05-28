#!/bin/bash
set -e

echo "🚀 开始部署 Security Audit 系统..."
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未安装 Docker"
    echo "请先安装 Docker: https://docs.docker.com/engine/install/"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ 错误: 未安装 Docker Compose"
    echo "请先安装 Docker Compose v2"
    exit 1
fi

echo "✅ Docker 环境检查通过"
echo ""

# 检查环境变量文件
if [ ! -f .env.production ]; then
    echo "📝 创建环境变量文件..."
    cp .env.production.example .env.production
    echo ""
    echo "⚠️  请编辑 .env.production 文件，填入你的 LLM API 配置："
    echo "   - OPENAI_API_KEY"
    echo "   - OPENAI_BASE_URL"
    echo "   - AI_MODEL"
    echo ""
    echo "编辑完成后，重新运行此脚本继续部署。"
    exit 0
fi

# 检查必需的环境变量
if grep -q "your_api_key_here" .env.production; then
    echo "⚠️  警告: .env.production 中仍包含默认值"
    echo "请确保已正确配置 LLM API 信息"
    echo ""
    read -p "是否继续部署？(y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

echo "✅ 环境变量文件检查通过"
echo ""

# 停止旧服务
if docker compose ps | grep -q "Up"; then
    echo "🛑 停止旧服务..."
    docker compose down
    echo ""
fi

# 构建镜像
echo "🔨 构建 Docker 镜像（这可能需要几分钟）..."
docker compose build
echo ""

# 启动服务
echo "🚀 启动服务..."
docker compose up -d
echo ""

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 初始化数据库
echo "💾 初始化数据库..."
if docker compose exec -T web pnpm prisma db push 2>/dev/null; then
    echo "✅ 数据库初始化成功"
else
    echo "⚠️  数据库初始化失败，可能已经初始化过了"
fi
echo ""

# 检查服务状态
echo "📊 服务状态："
docker compose ps
echo ""

# 显示日志
echo "📋 最近日志："
docker compose logs --tail=20
echo ""

# 获取服务器 IP
SERVER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="localhost"
fi

echo "✅ 部署完成！"
echo ""
echo "🌐 访问地址: http://${SERVER_IP}:3000"
echo ""
echo "📝 常用命令："
echo "   查看日志: docker compose logs -f"
echo "   重启服务: docker compose restart"
echo "   停止服务: docker compose down"
echo "   查看状态: docker compose ps"
echo ""
echo "📖 详细文档请查看: deploy.md"
