# PentAGI 待执行任务范围

状态：未执行。用户选择暂不配置 API Key，先完成本地与离线验证。

允许对象：本项目的独立 Electron 实现与专门创建的测试数据、测试进程、托管 Python 环境。测试仅使用隔离的 userData 目录与临时研究文件。

排除：Claude Science.app、Zcode 工作区、真实研究资料与系统密钥、ZenMux 服务、Crossref、Europe PMC，以及所有其他第三方系统。不得将正常业务接口调用扩大为针对供应商的扫描。

目标：检查渲染 XSS 到 IPC 的边界、文件操作和导出路径、API Key 泄露、LaTeX 注入与 shell escape、CSV 解析、托管环境进程回收与 Notebook 权限。使用模拟供应商响应和测试密钥；验证结论必须有复现证据。先静态审计，再局部动态测试，最后按严重程度报告和复测。

前置：Docker 已通过独立 colima-science-workbench 实例验证；Compose 已安装（docker-compose 命令）。尚需配置 PentAGI 真实聊天模型与 embedding 提供方，通过官方 ctester / etester 后再派发任务。当前没有 PentAGI 任务 ID 或报告，不得声称其已经通过体检。
