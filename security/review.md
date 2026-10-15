# 安全验证记录

这是本地检查与测试记录，不是 PentAGI 渗透报告。

## 已处理

- npm 初始依赖审计包含 csv-parse 原型污染风险及旧打包器的解压路径问题。升级 csv-parse、@electron/packager 及其依赖后，最终 npm audit 为零已知漏洞。
- Python 科研环境初始 JupyterLab 4.4.3 在 PyPI 元数据中有多项公告。已升级到 4.6.4，重新核对完整解析依赖集。前后记录在 work/claude-science/python-audit-before.json 和 python-audit-after.json。
- Renderer 启用 sandbox、contextIsolation，禁用 Node；IPC 同时验证发送者窗口、主 frame 和固定本地文档 URL。拒绝新窗口、外部导航、webview、权限请求与自动下载。
- Markdown 使用 DOMPurify，阻断图像、样式和表单等非必要 HTML。已用恶意 onerror 内容验证不生成可执行节点。
- Key 使用 safeStorage 加密，IPC 只返回 hasKey，错误信息不返回供应商响应体并对 Key 脱敏。保存与两个接口检测分别验证，配置变化会使旧检测结果失效。
- CSV 解析校验危险列名、行数、列数与长度。缺失值保持缺失。模型只接收统计摘要，不包含原始行。
- LaTeX 文稿转义特殊字符，固定模板与图表数值，不执行模型提供的原始 TeX。编译禁用 shell escape。实际导出双语 PDF 和图表测试通过。
- 外部链接限定 HTTPS 与指定科研站点；file: 链接被拒绝。
- RAG 仅索引项目选定资料，记录来源和字符偏移，校验向量数量/索引/维度/有限性。模型或资料变化时要求更新索引，不用陈旧语料伪装成功。
- Jupyter 只绑定 loopback，随机 token，进程使用固定 Python 模块命令而非任意 shell 拼接。停止后关闭进程组并删除临时 venv，保留研究文件。已进行真实创建、依赖安装、健康检查、停止与回收验证。

## 限制

没有配置真实 ZenMux Key，因此线上聊天、Embedding、模型兼容性与账户权限尚未验证。E2E 对这些接口使用模拟响应；公开 Europe PMC / Crossref 检索已分别返回 HTTP 200。

Python 初次 pip-audit 路径因本机 UV Python ensurepip 和网络超时未完成；替代检查使用 uv 解析完整固定版本依赖列表，再读取 PyPI 各版本的漏洞元数据。此检查不能发现未披露漏洞，也不是执行中的沙箱检测。

venv 不是操作系统沙箱。Jupyter 用户执行的代码拥有当前用户的权限。自动回收仅以断开连接和空闲判定；长时间实验应由研究者监控并主动保存文件。

尚未进行 PentAGI 扫描、真实攻击链测试、代码签名、公证或第三方独立审计。打包结果是本地开发版本。测试范围见 pentagi-scope.md；不针对原应用或外部供应商发起测试。

## 0.2 新增边界验证

附件 ID 使用 UUID 与固定存储根，不接受 renderer 提供的任意读取路径。当前消息和补充历史附件每次最多读取 6 个。缩略图来自原生图像解码与缩放；Office 通过受限 ZIP 成员及 XML 读取，不执行宏、公式或外部实体，拒绝 DTD 与过大解压内容。原生旧 Office 文件只交给模型接口，不在本地执行。

代码参考路径由用户明确选择后在主进程注册，工具参数只携带 referenceId 与相对路径。测试验证路径穿越、凭证文件与越界符号链接均被拒绝；代码工具没有命令执行能力。上传内容或目录中的指令不构成自动执行授权。

审稿修订要求合法结构，并经用户采用才替换当前文稿；测试验证无效结构拒绝、原稿保留、采用与撤回。新增 Office/XML/ZIP 依赖经 npm audit 检查未发现已知漏洞。使用测试模型响应的工具调用和修订测试不证明供应商兼容性或真实科研质量。

## 数学与形式化证明门禁

双模型审查以文稿、数据和证明证据的摘要绑定缓存，只重用通过结果，错误与不确定不放行。主进程在所有报告导出入口执行门禁，不能仅靠 renderer 显示的“通过”状态导出。模拟接口测试验证独立请求、拒绝、缓存失效与候选稿保留。

Lean 证明在独立 Docker 容器内验证：禁网、只读根文件系统、非 root、丢弃 capabilities、no-new-privileges、CPU/内存/进程数限制；仅挂载当前生成的受限证明文件。检查冻结命题、拒绝证明占位与额外公理，并核对目标 theorem 的公理诊断。真实测试中正确证明接受、错误证明拒绝，修改证明后报告门禁失效。该受限入口不支持任意 Lean 项目或插件；容器隔离也不等于不存在运行时漏洞。语义忠实度仍需人工确认。

数学排版采用固定命令白名单与花括号深度限制；拒绝文件/宏命令、TeX 的双上标字符编码和控制字符，不把模型原始 TeX 当成可执行文档。已验证正常分式/积分/集合公式真实编译，并对 input、write18、csname、def 与编码绕过做拒绝测试。

## 发布边界

macOS 发布使用 Developer ID、hardened runtime 和 Apple 公证；公证凭证只保存在系统钥匙串，源代码和 GitHub Actions 不包含 Apple 密码或签名私钥。DMG 的发布需经过 stapler validate 与 spctl 检查。Apple 公证是分发校验，不能替代安全审计或科研结论验证。

跨平台构建使用 electron-builder 26.15.3。运行时依赖 `npm audit --omit=dev` 无已知漏洞；当前构建工具链存在 8 项 moderate 间接告警，源于 @electron/get / global-agent 的 sprintf-js 依赖，暂无上游修复，不计作已经消除。Windows 包尚无 Authenticode 签名。Linux 拒绝使用 safeStorage basic_text 后端持久化 API Key。

## 0.2.1 流式公式渲染

Markdown 先由 DOMPurify 清理，禁止原始 MathML、SVG、样式与执行性 HTML，再将独立的公式槽交给本地 KaTeX 生成节点。CSP 未放宽，字体和 CSS 随应用提供。公式长度上限 8,000 字符、宏展开最多 1,000 次、显示尺寸有上限；递归宏和错误公式不会阻塞后续输出。

TeX 的 trust 回调只允许无内嵌用户名/密码的 HTTPS href/url，其他外部链接与 HTML 指令拒绝执行；点击后仍由主进程站点白名单检查。危险链接不显示为可点击 URL；未闭合公式在流式过程中保留待完成文本。测试以可控 SSE 验证完成前增量渲染、代码块排除、Markdown XSS、危险 TeX、CSP/字体、链接和重载。运行时依赖审计无已知漏洞；真实 ZenMux 本轮仍未联调。
