"""全文写作 API 路由包。

将原来的 writing.py（~1750 行）按功能拆分为：
  - models.py   全部 Pydantic 模型
  - utils.py    公用辅助函数
  - visuals.py  图表/框架图/AI 可视化生成
  - content.py  AI 内容生成/修改/批量/大纲
  - export.py   文档导出 + 模板解析
  - drafts.py   草稿 CRUD + 上传 + SSE 流

所有子路由统一挂载到该包的 router 上。
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/writing", tags=["writing"])

# 导入各模块并挂载子路由（顺序无依赖）
from . import visuals, content, export, drafts

router.include_router(visuals.router)
router.include_router(content.router)
router.include_router(export.router)
router.include_router(drafts.router)

__all__ = ["router"]
