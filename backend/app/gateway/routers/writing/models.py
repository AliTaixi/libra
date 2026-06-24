"""全文写作 Pydantic 请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChartGenerateRequest(BaseModel):
    """生成图表请求。"""
    tool: str = Field(default="1", description="1=Matplotlib, 2=Seaborn")
    chart_type: str = Field(..., description="bar, line, pie, scatter, box, violin, heatmap")
    data: list[str] = Field(..., description="数据，格式：名称:值1|值2|值3")
    x: str = Field(default="", description="X 轴标签，| 分隔")
    y: str = Field(default="", description="Y 轴标签，| 分隔")
    title: str = Field(default="", description="图表标题")
    xlabel: str = Field(default="", description="X 轴标题")
    ylabel: str = Field(default="", description="Y 轴标题")


class ChartGenerateResponse(BaseModel):
    """生成图表响应。"""
    svg_content: str = Field(..., description="SVG 内容")
    success: bool = Field(default=True)


class DiagramGenerateRequest(BaseModel):
    """生成框架图请求。"""
    mermaid_code: str = Field(..., description="Mermaid 图表描述代码")


class DiagramGenerateResponse(BaseModel):
    """生成框架图响应。"""
    svg_content: str = Field(..., description="SVG 内容")
    success: bool = Field(default=True)


class ChartFromTextRequest(BaseModel):
    """从原文直接生成图表请求。"""
    text: str = Field(..., description="选中原文")
    chart_type: str = Field(..., description="图表类型：bar line pie scatter box violin heatmap")
    title: str = Field(default="", description="图表标题（可选，留空由 AI 推断）")
    model_name: str = Field(default="", description="使用的模型名称")


class DiagramFromTextRequest(BaseModel):
    """从原文直接生成框架图请求。"""
    text: str = Field(..., description="选中原文")
    diagram_type: str = Field(..., description="Mermaid 图类型，如 graph TD、sequenceDiagram 等")
    model_name: str = Field(default="", description="使用的模型名称")


class ChapterExportItem(BaseModel):
    """导出的章节内容。"""
    title: str = Field(..., description="章节标题")
    content: str = Field(default="", description="该章节的 HTML 内容")


class ExportDocxRequest(BaseModel):
    """导出 Word 文档请求。"""
    template_path: str = Field(..., description="原始模板文件路径，用于保留页眉页脚/封面/声明")
    chapters: list[ChapterExportItem] = Field(default=[], description="各章节内容")
    markdown: str = Field(default="", description="完整文档的 Markdown 内容（备用）")
    output_name: str = Field(default="output.docx", description="输出文件名")


class ExportDocxResponse(BaseModel):
    """导出 Word 文档响应。"""
    file_path: str = Field(..., description="生成的 docx 文件路径")
    success: bool = Field(default=True)


class ExportMdDocxRequest(BaseModel):
    """通过 md-to-docx-skill 导出请求。"""
    markdown: str = Field(..., description="完整文档的 Markdown 内容")
    output_name: str = Field(default="output.docx", description="输出文件名")


class ParseTemplateRequest(BaseModel):
    """解析模板请求。"""
    template_path: str = Field(..., description="模板文件路径")


class StructureItem(BaseModel):
    """结构元素（二级/三级标题）。"""
    level: int = Field(..., description="标题级别 2 或 3")
    title: str = Field(..., description="标题文字")
    children: list["StructureItem"] = Field(default=[], description="子标题")


class ChapterInfo(BaseModel):
    """章节信息。"""
    id: str = Field(..., description="章节编号")
    title: str = Field(..., description="章节标题")
    sub_titles: list[str] = Field(default=[], description="二级标题列表（平铺）")
    structure: list[StructureItem] = Field(default=[], description="完整层级结构")
    body_text: str = Field(default="", description="该标题下的正文原文（模板占位内容）")


class ParseTemplateResponse(BaseModel):
    """解析模板响应。"""
    chapters: list[ChapterInfo] = Field(..., description="章节列表")
    variables: list[str] = Field(default=[], description="Jinja2 变量列表")
    success: bool = Field(default=True)


class GenerateOutlineRequest(BaseModel):
    """生成大纲请求。"""
    project_name: str = Field(..., description="项目名称")
    doc_type: str = Field(default="report", description="文档类型")
    description: str = Field(default="", description="补充说明")
    existing_structure: list[dict] | None = Field(default=None, description="已有章节结构，用于生成二级/三级标题")
    model_name: str = Field(default="", description="使用的模型名称")


class GenerateOutlineResponse(BaseModel):
    """生成大纲响应。"""
    chapters: list[dict] = Field(..., description="章节列表 [{id, title, description, sub_titles}]")
    success: bool = Field(default=True)


class StructureItemReq(BaseModel):
    """标题结构元素（供生成内容使用）。"""
    level: int = Field(..., description="标题级别")
    title: str = Field(..., description="标题文字")
    children: list["StructureItemReq"] = Field(default=[], description="子标题")


class GenerateContentRequest(BaseModel):
    """生成章节内容请求。"""
    chapter_title: str = Field(..., description="章节标题")
    chapter_description: str = Field(default="", description="章节描述")
    project_name: str = Field(default="", description="项目名称")
    doc_type: str = Field(default="report", description="文档类型")
    context: str = Field(default="", description="前文内容")
    word_count: int = Field(default=500, description="目标字数")
    structure: list[StructureItemReq] = Field(default=[], description="章节内的标题层级结构")
    model_name: str = Field(default="", description="使用的模型名称")


class GenerateContentResponse(BaseModel):
    """生成章节内容响应。"""
    content: str = Field(..., description="生成的 Markdown 内容")
    success: bool = Field(default=True)
    error: str = Field(default="", description="失败原因（success=false 时）")


class ReviseContentRequest(BaseModel):
    """修改内容请求。"""
    original_content: str = Field(..., description="原始内容")
    demand: str = Field(..., description="修改需求")
    chapter_title: str = Field(default="", description="章节标题")
    word_count_min: int = Field(default=0, description="字数下限")
    word_count_max: int = Field(default=0, description="字数上限")
    model_name: str = Field(default="", description="使用的模型名称")


class ReviseContentResponse(BaseModel):
    """修改内容响应。"""
    content: str = Field(..., description="修改后的内容")
    success: bool = Field(default=True)


class BatchGenerateContentRequest(BaseModel):
    """批量生成多章节内容请求。"""
    chapters: list[GenerateContentRequest] = Field(..., description="章节列表")
    model_name: str = Field(default="", description="使用的模型名称")


class BatchGenerateContentResponse(BaseModel):
    """批量生成多章节内容响应。"""
    contents: list[GenerateContentResponse] = Field(default=[], description="各章节内容")
    success: bool = Field(default=True)


class ExtractChartDataRequest(BaseModel):
    """AI 提取图表数据请求。"""
    text: str = Field(..., description="选中文本")
    chart_type: str = Field(..., description="图表类型：bar line pie scatter box violin heatmap")
    model_name: str = Field(default="", description="使用的模型名称")


class ExtractChartDataResponse(BaseModel):
    """AI 提取图表数据响应。"""
    data: list[str] = Field(default=[], description="格式化后的 data 参数列表")
    x: str = Field(default="", description="X 轴标签，| 分隔")
    y: str = Field(default="", description="Y 轴行标签（热力图用），| 分隔")
    title: str = Field(default="", description="图表标题")
    xlabel: str = Field(default="", description="X 轴标题")
    ylabel: str = Field(default="", description="Y 轴标题")
    success: bool = Field(default=True)


class ExtractDiagramCodeRequest(BaseModel):
    """AI 提取框架图代码请求。"""
    text: str = Field(..., description="选中文本")
    diagram_type: str = Field(..., description="Mermaid 图类型，如 graph TD、sequenceDiagram 等")
    model_name: str = Field(default="", description="使用的模型名称")


class ExtractDiagramCodeResponse(BaseModel):
    """AI 提取框架图代码响应。"""
    mermaid_code: str = Field(default="", description="生成的 Mermaid 代码")
    success: bool = Field(default=True)


class GenerateTableRequest(BaseModel):
    """AI 智能表格生成请求。"""
    text: str = Field(..., description="选中文本")
    model_name: str = Field(default="", description="使用的模型名称")


class GenerateTableResponse(BaseModel):
    """AI 智能表格生成响应。"""
    table_html: str = Field(default="", description="生成的 HTML 表格")
    caption: str = Field(default="", description="表格标题")
    success: bool = Field(default=True)


class AiGenerateVisualRequest(BaseModel):
    """AI 智能可视化生成请求。"""
    text: str = Field(..., description="选中文本")
    model_name: str = Field(default="", description="使用的模型名称")


class AiGenerateVisualResponse(BaseModel):
    """AI 智能可视化生成响应。"""
    content: str = Field(..., description="生成的 SVG/HTML 内容")
    content_type: str = Field(..., description="内容类型：svg / html")
    caption: str = Field(default="", description="图表标题/说明")
    success: bool = Field(default=True)


class DraftCreateRequest(BaseModel):
    """创建草稿请求。"""
    project_name: str = Field(default="", description="项目名称")
    doc_type: str = Field(default="report", description="文档类型")
    mode: str | None = Field(default=None, description="from-scratch | upload-template")
    model_name: str = Field(default="", description="使用的模型名称")
    kb_collection_id: str = Field(default="", description="关联的知识库集合 ID")


class DraftUpdateRequest(BaseModel):
    """更新草稿请求。"""
    project_name: str | None = None
    doc_type: str | None = None
    mode: str | None = None
    stage: str | None = None
    files: list | None = None
    chapters: list | None = None
    word_count_min: int | None = None
    word_count_max: int | None = None
    demand_input: str | None = None
    finished: bool | None = None
    generation_state: dict | None = None
    model_name: str | None = None
    kb_collection_id: str | None = None


class DraftListResponse(BaseModel):
    """草稿列表响应。"""
    drafts: list[dict] = Field(default=[], description="草稿列表")
    success: bool = Field(default=True)


class DraftResponse(BaseModel):
    """草稿响应。"""
    draft: dict | None = Field(default=None, description="草稿数据")
    success: bool = Field(default=True)


class DraftDeleteResponse(BaseModel):
    """删除草稿响应。"""
    success: bool = Field(default=True)


class ResumeResponse(BaseModel):
    """恢复生成响应。"""
    status: str = Field(..., description="started | already_generating | not_found")
    message: str = Field(default="", description="说明")
    success: bool = Field(default=True)


class StatusResponse(BaseModel):
    """生成状态响应。"""
    generation_state: dict = Field(default_factory=dict, description="生成进度")
    chapters: list = Field(default=[], description="最新章节内容")
    success: bool = Field(default=True)
