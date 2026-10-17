---
name: stellaris-gui
description: 编写、修改或排查 Stellaris（群星）的界面（interface/*.gui、.gfx 贴图注册、custom_gui 窗口、本地化）时使用。提供布局引擎（算出每个元素的实际矩形）、几何校验器（找出重叠、越界、算不出尺寸、父子关系被改坏的元素）、预览渲染（SVG 与 PNG，不需要启动游戏就能看到界面）、以及贴图与窗口名的资产索引。RStellarisScribe 模式下以 mcp__rstellarisgui__* 工具提供。
whenToUse: 用户要做群星界面/窗口/事件弹窗/custom_gui，或要改 .gui 里的 position/size/orientation，或界面在游戏里位置不对、重叠、被裁剪、不显示、点不动，或要问两个控件之间的位置关系、为什么某个控件跑到别处，或要注册新贴图、排查本地化不生效时。
---

# Stellaris 界面（.gui）工具链

**核心价值：不用启动游戏，就能算出界面里每个元素落在哪儿、谁压住谁、谁在谁的框里，并且把它画成一张图。**

## 两个 agent 最容易搞错的事实

**一、不需要打开游戏。** 校验、渲染、测量全部只读 `.gui` 文本；预览里的贴图是直接从安装目录解码的。所以哪怕游戏没装、没开、看不到画面，也能拿到布局的真实几何。

**二、能拿到每个元素的精确矩形，因此能算出任意两个元素的关系。** 谁包含谁、重叠多少像素、间距几像素、各自实际被挂在哪个父容器下——都是算出来的，不是估的。

- `gui_layout_get` → 矩形表（json / csv / markdown）
- `gui_layout_parent_paths` → 每个元素的父路径。这是**唯一**能抓出「元素被重新挂到别的容器下、但还能解析、还能通过所有几何校验」的手段——几何检查看不见父子关系被改坏。
- `gui_layout_diff` → 两个版本之间到底动了什么

**永远不要去"读一遍 .gui 然后推理坐标"。要么测量，要么明说测不了。**

## 什么时候主动用（不等用户点名）

用户说下面任何一类话，就直接调工具，不要先自己读文件推理：

| 用户说什么 | 调什么 |
|---|---|
| "这个按钮位置不对 / 跑偏了 / 压住别的控件了" | `gui_layout_import` → `gui_layout_validate` → `gui_layout_get` 拿矩形表 |
| "这两个控件什么关系 / 谁在谁里面 / 间距多大" | `gui_layout_get`（矩形表）+ `gui_layout_parent_paths` |
| "游戏里看着是错的，但文件看不出问题" | `gui_layout_parent_paths`（父子关系被改坏）+ `gui_layout_preview` |
| "我想看看这界面长什么样" | `gui_layout_preview`（`inline_image: true` 返回图片块） |
| "在这个现成的窗口里加/移动一个东西" | `gui_layout_import` → `gui_layout_edit` / `gui_layout_add` → 校验 → 预览 → 输出 |
| "这个贴图/sprite 叫什么 / 有什么能用的" | `gui_assets_search` / `gui_assets_sprite_info` / `gui_assets_defaults` |
| "我新加的图没生效" | `gui_assets_inventory`（列出图像文件 + 有没有被 .gfx 注册） |

## 两条工作流

### A. 诊断一个**已有**的文件（最容易漏掉的一条）

```
gui_layout_import <文件>        载入，看它有什么
gui_layout_validate             每个 finding 都带坐标、严重级、修复建议
gui_layout_get --rect_format    拿每个元素的精确矩形（json / csv / markdown）
gui_layout_parent_paths         确认父子关系没被改坏
gui_layout_preview inline_image true   直接看（返回 MCP 图片块）
```

**先看诊断，再改。** 不要跳过 validate 直接编辑。

### B. 新建一个窗口

```
gui_assets_defaults             拿到验证过的起始 sprite / 字体
gui_assets_search               挑真实存在的 sprite 名——**绝不编名字**
gui_layout_new                  得到一棵能通过校验的完整树
gui_layout_edit / gui_layout_add  调整
gui_layout_validate             逐条读 finding，不要只看 verdict
gui_layout_preview              看
gui_emit_files                  默认 dry_run，确认输出计划后再写
```

## 硬边界（这个工具自己都承认的）

- 所有几何都在 **1920×1080 基准分辨率**下，每份报告都会写明。游戏会缩放 UI，所以"重叠""越界"只在这个基准下有意义。
- 输出目录：游戏安装目录、用户数据目录、任何含 `descriptor.mod` 的文件夹都会**被拒绝**。要覆盖原版文件，只能走 `gui_emit_override`，它会记录原版文件的 sha256，并拒绝在哈希变了之后继续。
- 尺寸关键字**按元素种类不同**：`instantTextBoxType` 只吃 `maxWidth/maxHeight` 且**拒绝** `size`；`iconType` 没有 size；`button`/`listBox` 等吃 `size = { x y }`；`containerWindowType`/`gridBoxType` 吃 `size = { width height }`。写错引擎不报错，只是不生效。
- 本地化 `.yml` 必须 **UTF-8 带 BOM**（没有 BOM 引擎直接忽略整个文件）；`.gui`/`.txt` 是 UTF-8 **不带** BOM。
- 预览里的**文字宽度不精确**：模型是 `bmfont-advance-sum`（xadvance 求和），不做 kerning，换行是工具自己的贪心规则，动态文本（`$VAR$`、`[Command]`、`£$VAR$`、`defined_text`）是跳过或用最坏情况估的。**别把"文字放不下"当成确定结论。**

## 知识库

这个服务器带一个可查询的知识库，每条规则都标了证据（原版 file:line、引擎日志行、或实测计数），并且有 `待确认` 一节写明**哪些没能确立**。

```
gui_knowledge_search <两三个具体词>
gui_knowledge_topic <topic_id>
```

规则要去知识库查，**不要去 grep `docs/gui-pitfalls.md`**——那个文件是"这些规则当年怎么被发现的"的历史，知识库里的才是规则本身。
