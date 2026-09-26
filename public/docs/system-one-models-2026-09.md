# System One 模型进展：Jev、Laya 和开源阵营

数据截至 2026 年 9 月 26 日。文中数字都来自公开来源，出处见文末。

一句话概括：这类模型不写文章，只做判断。你给它一段文本和几个带类型的问题，它返回标签、分数和概率。

## 为什么要另做一类模型

用生成式 LLM 判断“这张工单该给哪个部门”，代价太高。要等 500 毫秒到 2 秒逐 token 吐字，还要写正则从自由文本里抠标签。

更麻烦的是置信度。LLM 输出的 `confidence: 0.95` 只是听起来自信的 token，背后没有校准。它可能 95% 的情况做对，却说不清剩下那 5% 是哪 5%。

System One 模型换了做法。它把状态（文本、邮件、工单或 JSON）和若干带类型的问题一起读进去，一次前向传播算完所有问题，直接返回类型化答案和概率。它不生成字符串，所以写不出格式错误的 JSON。

名字来自卡尼曼的“系统一”，指快而直觉的判断。

TypeSafe AI 创始人 Diogo Almeida 把它叫作“给软件用的前沿智能函数调用”。

## 三种题型

所有 System One 模型都用同一套原语。你提前把答案空间定好，模型只负责在里面选。

| 原语 | 问什么 | 返回什么 |
|---|---|---|
| choice | 从一组选项里挑一个 | 选项名、各选项概率、confidence |
| score | 把内容放到有序等级上 | 期望分数、各等级概率、confidence |
| noul | 一个是非问题 | P(true)，取值 0 到 1 |

举几个用法。choice 判断工单归 billing、technical 还是 account。score 给客户愤怒程度打分。noul 判断一条消息是否要求退款。

答案空间被限定成标签和数字之后，下游代码可以直接消费，不需要解析。

## Jev

Jev 是 TypeSafe AI 的旗舰模型，2026 年 9 月 15 日发布，当前版本 1.13。

官方参数：每百万输入 token 收 $0.042，输出不计费；延迟 70 ms～500 ms；单次请求上限 64k token，其中 state 加最长问题不超过 32k；只接受文本输入。

它的训练方法叫 RLCD（Reinforcement Learning for Calibrated Decisions）。RLHF 优化人类偏好，RLVR 优化可验证答案，RLCD 优化的是校准过的决策概率。

Jev 不做微调，同一套权重服务所有账户。你通过 state、instructions 和 criteria 塑造它的判断，不用自己训练。

一个要留意的限制：英语是主要训练语言，准确率最高。中文等 CJK 文本能处理，官方明说效果不均，建议先在自己的数据上测。

公司方面，TypeSafe AI 由 Diogo Almeida（CEO，在 OpenAI 做过让语言模型遵循指令的研究）、Sasha Sheng（COO）和 Erik Gafni（CTO）创办。公开报道称其种子轮融资 4,000 万美元，由 DCVC 领投。

## 开源阵营

Jev 发布后的两周里，开源侧冒出一批同类模型。

| 模型 | 发布方 | 许可 | 延迟 | 特点 |
|---|---|---|---|---|
| Laya | Convai Innovations | Apache 2.0 | 32.8 ms～39.5 ms | 支持 100 多种语言，自带路由 |
| von | wfzyx | Apache 2.0 | 声称亚 15 ms | 仓库 683 星，用 JevBench 自测 |
| Kev | Jared Palmer | Apache 2.0 | 36 ms～179 ms | 0.8B、4B、9B 三档，Kev-4B 上了 OpenRouter |
| CLM-8B | Jacky Kwok 团队 | 开源 | 未公布 | 用对比学习目标给候选动作打分 |
| GLiNER2.5-Decide | Fastino Labs | Apache 2.0 | 38 ms～167 ms | 340M 参数编码器，还能抽 span 和关系 |
| Tev1-4B-experimental | Together AI | 开源 | 未公布 | Qwen3.5-4B 微调，训练成本 17 美元 |

三条路线值得单独看。

Laya 的作者 Nandha Kishor 在 2025 年 3 月就发过 arXiv 论文（2503.23303），用 PPO 在序列表示上输出销售对话的转化概率。同年 9 月他发了第二篇（2510.01237），给出用强化学习做 schema 决策的框架。2026 年 9 月 Jev 发布后，他修掉旧方案的架构限制，做成了通用的开源模型 Laya。

Kev 的做法更省。它是 Qwen3.5-4B-Base 上的 LoRA 适配器加指针头，对外提供 TypeSafe 的 `/v1/systemone` 接口。

Together AI 那条路最便宜。他们用 Qwen3.5 4B 微调出 Tev1-4B-experimental：给一段上下文、一个问题、2 到 24 个选项，模型返回一个答案字母。训练成本 17 美元，配方和教程一起公开。

## 评测

JevBench 是 Benchmark Heaven 自建的基准，官方声明与 TypeSafe 无关。它测四个轴：高于随机的智能、校准、速度、成本，不合成一个总分。

独立复核在 2026 年 9 月 24 日给出三个结论。

准确率上，Jev 与中价位 LLM 持平，落后前沿 6.5 到 11.5 个百分点。

校准上，Jev 在熟悉的英语任务里是所测模型中最准的。换到分布外数据，两个方向都会偏，用 50 到数百条标签拟合一个温度参数，就能修掉大部分误差。

规模最大的一项预注册复现（arXiv 2609.24574，7,977 条人工标注）里，Jev 在 15 个任务中的 14 个落后于 19 个 LLM 里的最优者，宏 F1 中位数差 11.6 分。

一个 200 条样本、六个模型的对比更直观：Claude Fable 5.1 准确率 84.0%，GPT-6 Astra 79.0%，Jev 72.5%。DeepSeek V4.1 Flash、MiniMax M3 和 Kimi K3 与 Jev 的差距在噪声范围内。

JevBench 公开榜单上，von 1.2 在 easy 档 100.0%，standard 档 63.9%，hard 档 38.7%。难度一上来，所有模型都掉得很快。

## 先例之争

围绕 Jev 的争议集中在原创性，不在能力。

关键的旧技术是这样：把 prompt 结束在答案该出现的位置，只取模型对允许标签 token 的打分，再做一次 softmax。这个读法不新。vLLM 用 `logprob_token_ids` 暴露它，SGLang 用 `/v1/score`，任何开源模型都能这么读。

Laya 作者的不满在别处。他用同样的非自回归决策思路做了垂直场景，论文、权重、数据集都公开了，一年后同类思路换个通用包装就成了“突破”。

TypeSafe 一侧的说法是，Jev 的价值在训练方法和工程栈：新的模型架构、并行采样器，以及 RLCD 这套训练方法。他们也承认不打算证明定价没被补贴，并说明公开评测都在美西的笔记本上跑。

读这类内容要小心。那份独立复核逐条给来源打了等级，结果不算好看：33 篇 dev.to 和 Medium 文章里，只有 5 篇做了认真的测量，11 篇样本偏小或是模型互评，17 篇只是复述厂商说法。

## 怎么上手

Jev 走 `POST /v1/systemone`，或者用官方 Python、JS SDK。目前通过 waitlist、OpenRouter 和 Vercel AI Gateway 接入。

Laya 最省事：

```bash
python -m pip install laya
```

需要 Python 3.10 以上。装完用 `Router` 发一次请求，第一次运行会自动下载 checkpoint：

```python
from laya import Router

router = Router()
state = "Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan."
questions = {
    "department": {
        "type": "choice",
        "instructions": "Which department should this handle?",
        "criteria": {
            "billing": "invoices, payments, refunds",
            "technical": "bugs, outages, system errors",
            "other": "everything else",
        },
    },
    "churn_risk": {
        "type": "noul",
        "instructions": "Does the user threaten to cancel or leave?",
    },
}
result = router.predict(state, questions)
```

von、Kev、GLiNER2.5-Decide 都是自己跑权重的仓库，地址见文末。

长文档是 Laya 的一个坑。checkpoint 默认只读 1,024 token，处理长文要显式传 `max_len=8192`。官方测下来，前面有大约 4,000 token 文本时，20 条请求对 16 到 18 条；再长就不稳定。

如果你在 Codex 里用，本机已经配好 jev 的 MCP server（`jev-use`），提供 `jev_judge` 批量判断和 `jev_gate` 单动作风险闸两个工具。

## 还看不清的地方

中文场景的公开评测几乎没有。Jev 官方建议非英语负载先自测；Laya 声称支持 100 多种语言，但没有第三方验证过中文质量。

校准能不能迁移到你的数据上，取决于你先有一批带标签的样本。没有标签，那个温度参数就无从拟起。

Jev 没有技术论文、没有开源权重、没有公开训练集。想验证它的训练方法，只能等复现工作。

这类模型的商业形态还没定。两周内出现多个开源复现，第一梯队的定价能撑多久是个悬念。

## 参考资料

- TypeSafe AI 文档，System One 概念：<https://docs.typesafe.ai/concepts/system-one>
- TypeSafe AI 模型与价格：<https://docs.typesafe.ai/models>
- TypeSafe AI 发布博客：<https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- 独立复核，Jev 发布八天后的证据梳理：<https://dev.to/gde/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-1kln>
- JevBench（Benchmark Heaven）：<https://benchmarkheaven.com/jev-models>
- Laya 仓库：<https://github.com/NandhaKishorM/laya>
- Laya 作者自述：<https://dev.to/nandakishor_m_6cc0adfde9f/i-built-non-autoregressive-decision-models-a-year-ago-then-a-frontier-lab-called-it-a-18me>
- von 仓库：<https://github.com/wfzyx/von>
- Kev 仓库：<https://github.com/jaredpalmer/kev>
- Together AI 的 Jev 类分类器教程：<https://www.together.ai/blog/how-to-train-your-own-jev>
- System One 模型清单：<https://systemonemodels.org/models/>
