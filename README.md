# Science Workbench · AI 科研工作台

Electron/macOS arm64 独立实现。参考本机 Claude Science 安装包的静态证据与 Zcode 的会话引导语义；没有复制它们的程序代码。分析材料在 `work/claude-science/`。

## 使用

打开 `dist/Science Workbench-darwin-arm64/Science Workbench.app`，或在项目目录执行：

```sh
npm ci
npm start
```

左侧新建项目，填写研究问题。底部设置页输入 ZenMux API Key，并选择聊天与 Embedding 模型。“保存设置”使用 Electron safeStorage 本地加密保存；“保存并检测”分别发送小请求验证两个接口，可能产生费用。留空保留已有 Key，也可显式删除。检测只证明当时该模型接口请求成功，不保证账户所有模型可用。

聊天模型：`anthropic/claude-sonnet-5.5`、`google/gemini-4-argon`。
Embedding：`google/gemini-embedding-2`、`openai/text-embedding-3-large`。
Base URL 固定为 `https://zenmux.ai/api/v1`。
没有 Key 可使用设置页邀请入口：<https://zenmux.ai/invite/GBQMC5>。仍可使用论文检索、CSV / Excel 本地统计和本地编辑；离线排版导出需明确关闭模型复核，形式化证明门禁仍独立生效。

## 科研流程

1. **研究助手**：科研对话、可证伪假说、实验设计、描述统计解读、论文草稿。生成中输入文字成为持久化引导，在当前回复结束后进入续轮；停止后需明确继续。不会声称普通 HTTP 请求可以原地追加消息。
2. **论文与证据**：Europe PMC / Crossref 实时元数据检索，选择论文加入证据库后从结果隐藏；按 DOI 去重，可在证据库逐篇追问，或结合笔记继续研究。PMC 条目可请求开放全文；不可获取时仅摘要。也可导入 PDF / Markdown / 文本；扫描 PDF 未包含文字时需要先做 OCR。
3. **RAG**：点击“建立 / 更新索引”。选中文献的全文或摘要、导入资料和研究笔记按约 1200 字符分块，重叠约 200 字符，向量保存在应用本地目录。发出研究问题时检索前 6 个语义相关片段并交给模型，可在证据库核对片段来源、字符区间与相似度。语义相似度不等于科学有效性。资料变化或模型切换需更新索引；没有偷偷使用过期索引。首版上限为 300 个片段，适合小型项目，不是大规模文献服务。
4. **数据与图表**：本地追加 CSV / Excel .xlsx 或数据目录（每项目最多 5 个文件，每文件最大 5MB / 30,000 行；Excel 最多 20 张表，行数按工作簿合计），切换文件和工作表，分别查看描述统计、缺失值统计、散点图；不自动合并。Excel 公式仅使用缓存值，不执行公式，缺少缓存视为缺失。旧版 .xls 请另存为 .xlsx。空值不当零。AI 仅接收统计摘要，原始行不会自动上传。显示和论文图表最多取前 250 个成对有效点，并明确标注。
5. **论文与报告**：编辑 Markdown 风格正文，导出 Markdown、LaTeX 或 PDF。中英文混排，参考文献使用稳定的 P 编号，图表来自真实导入数据。没有实验数据时模型被要求标为待完成。PDF 需要本机 XeLaTeX、xeCJK、pgfplots、Times New Roman 和 Songti SC；本机编译已验证，禁用 shell escape，文稿文本经过 TeX 转义。
6. **实验环境**：自动查找 Python 3.11，创建项目专属 venv、安装固定依赖，启动带随机 token 的本地 Jupyter。当前选中数据写入 `dataset.csv`，所有数据表写入 `data/`，`datasets.json` 记录文件与工作表映射。启动环境时保存数据快照；数据改变后重建环境以更新。AI 回复可保存为 Notebook，代码需审查后在 Jupyter 执行；保存 Notebook 不等于执行实验。
7. **回收**：停止、退出应用时关闭托管进程组并删除 venv；断开且空闲 15 分钟后自动回收，忙碌内核不触发该条件。研究文件与 Notebook 保留在 `research-files/<project-id>/`。异常退出后重启会尝试核对并清理残留的托管 Jupyter。venv 只隔离依赖，Jupyter 代码以当前用户权限执行，不是 OS 沙箱。

## 数据与隐私

默认数据目录由 Electron `app.getPath('userData')` 决定，通常为 `~/Library/Application Support/science-workbench/`。项目、原文与索引保存在本机；API Key 单独加密，渲染进程只能读取是否已配置。

模型请求会向 ZenMux 发送研究问题、必要会话历史、文献摘要/命中片段、研究笔记和统计摘要。建立索引会发送待索引文本；使用 RAG 会发送检索问题。论文查询发到所选数据库。未配置有效 Key 时没有真实聊天/Embedding 测试结果。

## 验证与安全状态

```sh
npm run check
npm test
npm run test:e2e
npm run test:environment  # 首次下载 Python 依赖，启动真实 Jupyter 后回收
npm audit
npm run package
```

桌面 E2E 使用隔离 userData、测试 Key 和模拟模型响应，覆盖界面、加密、引导续轮、PDF、PDF 导入、RAG 与 API 检测。真实 venv/Jupyter 创建及清理已另行验证。公开论文检索服务有独立网络检查；模拟结果不会混入正式项目。

PentAGI 未执行：用户选择暂不配置模型 Key。Docker 独立 Colima 实例和 Compose 已准备；还需真实 LLM/Embedding 凭证、官方 ctester/etester 和任务报告。范围与限制见 `security/pentagi-scope.md`；不得将 npm audit 或桌面测试当作 PentAGI 报告。

## 会话附件、代码参考与审稿修订（0.2）

- **附件**：会话输入框支持粘贴图像/文件，或点击“附件”多选上传；每条消息最多 6 个，单个最大 20MB。图片显示缩略图，文件显示类型与名称缩略卡，右上角 × 删除待发送附件。草稿和已发送附件引用随项目保留，生成中的附件随引导在下一安全边界应用。图像会实际作为多模态内容发送；PDF/UTF-8 文本、DOCX/XLSX/PPTX 在本地提取正文/表格后发送，不只传文件名。Office 宏和单元格公式不会执行；Excel 公式只展示其存储结果与公式文本。旧版 DOC/XLS/PPT 作为原生文件发送，是否支持由模型和 ZenMux 路由决定，不支持时请另存为现代 Office 格式。模型的文字接口检测不等于已验证图像或原生文件能力。
- **RAG 文件类型**：知识库也支持导入 DOCX/XLSX/PPTX/CSV/JSON，与原有 PDF/文本共同索引。会话附件不会自动加入知识库，需要时请在“论文与证据”明确导入。
- **代码目录**：在“论文与报告”中输入/粘贴路径、拖入目录，或选择目录。AI 通过工具按需列出、字面搜索和带行号读取实现；不执行原实现，也不自动运行目录内脚本。每轮最多 9 次模型交互，文件列表可分页、源码可分段读取；搜索跳过大于 2MB 文件，但仍可直接读取。当前项目以外目录、越界符号链接、常见凭证和依赖缓存被排除。报告页展示本轮实际读取记录；未读过的实现不能被宣称已验证。源码会按实际读取范围发送给模型，请只选择有权共享的实现目录。
- **报告语种**：20 项：简体/繁体中文、英语、日语、韩语、西班牙语、法语、德语、葡萄牙语、俄语、阿拉伯语、印地语、意大利语、印尼语、越南语、土耳其语、孟加拉语、乌尔都语、波斯语和泰语。报告页的语种选择与科研会话共享项目设置。LaTeX 根据文字系统配置字体；需要本机对应字体和 polyglossia 等组件。不能以一次 PDF 编译成功证明任何语言都无缺字，验证记录包含实际测试语言和缺字检查。
- **审稿修订**：在报告页输入审稿意见，点击“按意见生成修订草稿”。AI 基于当前文稿、意见、项目证据和参考实现生成完整修订稿与逐条回应。原稿不被自动覆盖；可编辑草稿，点击“采用此修订”才替换，并可“撤回上一次采用”。无效的模型修订结构会报错并保留原稿。无法靠现有证据回答的意见要求明确补充实验/数据，不虚构完成情况。

新增验证：`npm run test:attachments`，覆盖缩略图、上传、数量限制、删除、重启保留、Office 内容进入模型请求、代码工具读取、语种与审稿修订采用/撤回。真实 ZenMux 图像、Office 原生文件、工具调用与修订质量仍需有效 Key 联调。

## 数学复核与内置形式化证明

设置中的“数学内容联合验证”默认开启。采用 AI 报告、采用审稿修订以及导出前，两个指定聊天模型独立复核同一文稿；只有同时通过才放行。失败、不确定、接口错误或意见不一致会显示原因，并保留候选稿。修改文稿、数据或证明会使旧结果失效。未配置 Key 时，可明确关闭此项做离线编辑与排版；关闭不代表数学结论已经验证。模型复核不等于形式化证明。

报告页内置 Lean 4.35.0 工作区：填写原问题 → AI 起草或手填命题 → 人工核对并冻结命题 → AI 生成/修复证明体 → 点击内核验证 → 确认语义一致。环境按钮负责启动本机专用 Colima/Docker 并构建 Lean 或 Mathlib 镜像，首次需要联网下载。镜像构建脚本随应用提供，运行证明时容器禁网、只读且限制资源。不需要在聊天窗口手工运行 Lean 命令。

验证拒绝 sorry/admit、新公理、元程序等绕过，只接受固定命题的真实内核结果，并展示使用的公理。形式化证明开关或正文中的形式化证明声明会触发独立报告门禁，即使关闭模型复核仍须内核通过与人工语义确认。Lean 接受只说明该形式化命题相对内核及所列公理成立，不能代替自然语言与形式化命题的忠实度审查。

当前内置证明后端为 Lean 4，Mathlib 按需构建；尚未接入 Isabelle、Rocq、商业证明服务或用户列出的所有专用证明模型。AI 候选生成使用设置中的 ZenMux 聊天模型。环境未就绪或内核拒绝时会明确标为未验证。

验证命令：`npm run test:math-gate`（模拟双模型），`node tests/formal-proof.e2e.cjs`（真实 Lean 镜像与桌面门禁）。实际结果见 `work/claude-science/formal-kernel-validation.json`。无 Key 的模型测试不代表已完成真实供应商联调。

数学 PDF 支持 `$...$` 行内公式与 `$$...$$` 多行公式，包含分式、积分、求和、希腊字母和常见集合符号。仅允许固定数学命令集；读取文件、宏定义、TeX 控制字符编码等结构会被拒绝。复杂环境与自定义宏暂不支持，普通正文继续转义。真实 XeLaTeX 已验证中英文与公式混排。

## 安装包与下载页

下载页：https://bennix.github.io/AIScience/  
版本与校验文件：https://github.com/bennix/AIScience/releases

- macOS Apple Silicon：Developer ID 签名的 DMG，应用与 DMG 分别提交 Apple 公证并装订票据。仅在公证和 Gatekeeper 检查成功后发布；`release/latest-notarized/` 保留本地最新公证 DMG 与 SHA-256。
- Windows x64：NSIS EXE；Linux x64：DEB / RPM。推送 `v*` 标签后由 GitHub Actions 原生 runner 构建并上传到同一 Release，附 SHA-256。Windows 当前没有 Authenticode 签名证书。
- Windows / Linux 为预览包。核心桌面功能使用 Electron；Python 自动环境管理、字体和 Lean/Colima 自动配置目前以 macOS 为主，不能据安装包成功就声称其他平台所有外部工具已验证。Linux 必须有可用的系统加密后端才能保存 API Key，拒绝 basic_text。

本地 macOS 发布：在钥匙串中创建名为 `AIScience` 的 notarytool 凭证，确保 Developer ID Application 私钥可用，然后执行 `npm ci`、`npm run dist:mac`、`npm run notarize`。凭证不写入项目，脚本只引用钥匙串 profile；可通过 `NOTARY_PROFILE` 更换 profile 名称。不要把 App 专用密码、P12 或密钥放进仓库。Windows / Linux 构建分别使用 `npm run dist:win`、`npm run dist:linux`。

网站为 `site/` 下静态页面，经 GitHub Pages workflow 发布。下载列表优先读取最新 GitHub Release，失败时使用 `site/releases.json`；尚未构建的资产显示发布状态，不制造无效的下载按钮。可用 `node tests/site.e2e.cjs` 验证响应式布局、下载链接与回退。

## 流式 Markdown / LaTeX（0.2.1）

AI 对话使用 SSE 增量输出，生成完成前即可查看已收到的内容；同一帧合并渲染，避免每个字符重复排版。标题、列表、表格、引用和代码块按 Markdown 显示。对话、报告预览和修订说明共享本地 KaTeX 渲染，支持 `$…$`、`$$…$$`、`\(...\)`、`\[…\]`；代码块中的公式保持源码。公式未闭合时先显示待完成内容，闭合后排版；语法错误会保留原文与提示。

`\href{https://…}{文字}` 和 `\url{https://…}` 可显示 HTTPS 链接；危险协议和 TeX HTML 指令不被执行。链接点击仍受应用主进程的科研站点白名单限制。字体、CSS 和渲染库随应用打包，无需额外 CDN。Markdown HTML 先经 DOMPurify 清理，随后只由 KaTeX 创建公式节点；宏展开、公式长度和显示尺寸有上限。

`npm run test:stream-math` 使用可控 SSE 与模拟模型，检查生成结束前的增量显示、四种公式分隔符、字体/CSP、代码块、链接、危险输入以及报告重载。真实 ZenMux 兼容性仍须有效 Key 联调。

## 论文追问与多个数据文件（0.3.0）

论文的“基于此文追问 / 后续研究”将聚焦该来源，带入摘要、已获取全文的前 30,000 字符和研究笔记。启用 RAG 时仅检索聚焦论文的片段；可取消聚焦恢复整个证据库。全文摘录明确标记截断范围。入口只填入可编辑的问题，不自动发送或覆盖已有输入。

文件及目录导入按整批处理：超过 5 文件或存在无效文件时不添加部分结果；重复内容不重复计数。目录跳过隐藏项和符号链接。旧项目的单个 CSV 自动迁移。多文件统计摘要可用于 AI 解读及报告，原始数据行不会自动发送。

验证：`npm test`、`npm run test:data-literature`、`npm run test:e2e`、`npm run test:attachments`、`npm run test:math-gate`。模型与检索联调使用离线模拟响应，没有声称完成真实 ZenMux 或 PentAGI 测试。
