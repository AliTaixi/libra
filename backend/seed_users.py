"""
种子用户脚本 — 向数据库中添加预置管理员和超级管理员账号。

管理员（10位）：admin@1 ~ admin@10，密码与账号相同
超级管理员（1位）：super@1，密码与账号相同

使用方法：
  1. 确保 .env 中的 DATABASE_URL 配置正确
  2. 在项目根目录下运行：

     python seed_users.py

  3. 重复账号会被自动跳过（不会报错）
"""

import asyncio
import base64
import hashlib
import os
import sys
from pathlib import Path

import bcrypt


# ── 密码哈希（与 backend/app/gateway/auth/password.py 保持一致）──────

def _pre_hash_v2(password: str) -> bytes:
    """SHA-256 pre-hash to bypass bcrypt's 72-byte limit."""
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    """Hash a password (v2 — SHA-256 + bcrypt)."""
    raw = bcrypt.hashpw(_pre_hash_v2(password), bcrypt.gensalt()).decode("utf-8")
    return f"$dfv2${raw}"


# ── 数据库连接 ──────────────────────────────────────────────────────

def load_dotenv(path: str) -> dict[str, str]:
    """Simple .env loader — reads KEY=VALUE lines."""
    env = {}
    if not Path(path).exists():
        return env
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip()
    return env


def get_database_url() -> str:
    """Read DATABASE_URL from .env or environment."""
    env_file = Path(__file__).resolve().parent / ".env"
    env = load_dotenv(str(env_file))
    url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print("❌ 未找到 DATABASE_URL，请检查 .env 文件或环境变量")
        sys.exit(1)
    return url


# ── PostgreSQL 模式 ─────────────────────────────────────────────────

async def seed_postgres(database_url: str):
    """使用 asyncpg 直接连接 PostgreSQL 插入用户。"""
    try:
        import asyncpg
    except ImportError:
        print("❌ 请先安装 asyncpg: uv add asyncpg 或 pip install asyncpg")
        sys.exit(1)

    conn = await asyncpg.connect(database_url)
    try:
        # 确保表存在（如果 gateway 还没初始化）
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(320) UNIQUE NOT NULL,
                password_hash VARCHAR(128),
                system_role VARCHAR(16) NOT NULL DEFAULT 'user',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                oauth_provider VARCHAR(32),
                oauth_id VARCHAR(128),
                needs_setup BOOLEAN NOT NULL DEFAULT FALSE,
                token_version INTEGER NOT NULL DEFAULT 0
            )
        """)
        # 创建索引（忽略已存在的）
        try:
            await conn.execute("CREATE INDEX IF NOT EXISTS ix_users_email ON users(email)")
            await conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_identity
                ON users(oauth_provider, oauth_id)
                WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL
            """)
        except Exception:
            pass

        await _seed_users(conn, is_postgres=True)
    finally:
        await conn.close()


# ── 通用插入逻辑 ────────────────────────────────────────────────────

USERS_TO_CREATE: list[tuple[str, str, str]] = []

# 10 位管理员
for i in range(1, 11):
    email = f"admin@{i}"
    USERS_TO_CREATE.append((email, email, "admin"))

# 1 位超级管理员
USERS_TO_CREATE.append(("super@1", "super@1", "super"))


async def _seed_users(db, *, is_postgres: bool):
    """遍历预置用户列表，跳过已存在的邮箱。"""
    created = 0
    skipped = 0

    for email, password, role in USERS_TO_CREATE:
        # 检查是否已存在
        if is_postgres:
            row = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
        else:
            cursor = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
            row = await cursor.fetchone()

        if row:
            print(f"  ⏭️  已存在: {email} ({role})")
            skipped += 1
            continue

        import uuid
        password_hash = hash_password(password)
        user_id = str(uuid.uuid4())

        if is_postgres:
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc)
            await db.execute(
                """
                INSERT INTO users (id, email, password_hash, system_role, created_at, needs_setup, token_version)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                user_id, email, password_hash, role, now, False, 0,
            )
        else:
            await db.execute(
                """
                INSERT INTO users (id, email, password_hash, system_role, created_at, needs_setup, token_version)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
                """,
                (user_id, email, password_hash, role, False, 0),
            )

        print(f"  ✅ 已创建: {email} ({role})")
        created += 1

    print(f"\n📊 统计: 新建 {created} 个，跳过 {skipped} 个（已存在）")


# ── SQLite 模式 ─────────────────────────────────────────────────────

async def seed_sqlite(database_url: str):
    """使用 aiosqlite 连接 SQLite 数据库。"""
    # SQLite URL: sqlite+aiosqlite:///path/to/db 或 sqlite:///path
    import re
    match = re.match(r"sqlite(?:\+aiosqlite)?:///(.+)$", database_url)
    if not match:
        print(f"❌ 无法解析 SQLite 路径: {database_url}")
        print("   期望格式: sqlite+aiosqlite:///path/to/db")
        sys.exit(1)

    db_path = match.group(1)
    if not Path(db_path).exists():
        print(f"❌ 数据库文件不存在: {db_path}")
        print("   请先启动 DeerFlow 以初始化数据库")

    try:
        import aiosqlite
    except ImportError:
        print("❌ 请先安装 aiosqlite: uv add aiosqlite 或 pip install aiosqlite")
        sys.exit(1)

    async with aiosqlite.connect(db_path) as conn:
        # 确保表存在
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(320) UNIQUE NOT NULL,
                password_hash VARCHAR(128),
                system_role VARCHAR(16) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                oauth_provider VARCHAR(32),
                oauth_id VARCHAR(128),
                needs_setup INTEGER NOT NULL DEFAULT 0,
                token_version INTEGER NOT NULL DEFAULT 0
            )
        """)
        try:
            await conn.execute("CREATE INDEX IF NOT EXISTS ix_users_email ON users(email)")
        except Exception:
            pass
        await conn.commit()

        await _seed_users(conn, is_postgres=False)


# ── 入口 ────────────────────────────────────────────────────────────

def _fix_docker_host(url: str) -> str:
    """将 host.docker.internal 替换为 localhost（在宿主机上运行时使用）。"""
    return url.replace("host.docker.internal", "localhost")


async def main():
    print("=" * 50)
    print("  DeerFlow 种子用户脚本")
    print("=" * 50)
    print()

    database_url = get_database_url()
    print(f"📁 数据库 URL: {database_url[:60]}...")

    # 如果在宿主机运行（host.docker.internal 不可达），自动替换为 localhost
    import socket
    try:
        socket.create_connection(("host.docker.internal", 5432), timeout=3).close()
    except (OSError, socket.gaierror, TimeoutError):
        fixed = _fix_docker_host(database_url)
        if fixed != database_url:
            print("⚠️  host.docker.internal 不可达，自动切换为 localhost")
            database_url = fixed
    print()

    if database_url.startswith("postgresql"):
        await seed_postgres(database_url)
    elif database_url.startswith("sqlite"):
        await seed_sqlite(database_url)
    else:
        print(f"❌ 不支持的数据库类型: {database_url}")
        print("   仅支持 PostgreSQL 和 SQLite")
        sys.exit(1)

    print()
    print("✅ 完成！你可以使用以下账号登录：")
    print("   管理员: admin@1 ~ admin@10（密码同账号名）")
    print("   超级管理员: super@1（密码: super@1）")


if __name__ == "__main__":
    asyncio.run(main())
