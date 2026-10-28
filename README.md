# PLCS7-1200 数字输入采样机制

一个纯静态的教学微仿真。输入脉冲宽度、到来时刻、滤波时间和扫描周期，点击“发出一个波”，对照四行信号：现场输入、滤波后、普通采样 I、脉冲捕捉 I。页面适配电脑、竖屏手机和横屏手机。

## 预览

直接打开 `index.html`，或在仓库目录运行 `python -m http.server 8765` 后访问 `http://127.0.0.1:8765/`。

## Cloudflare Pages

连接此仓库，生产分支选 `main`；Framework preset 选 `None`；Build command 填 `exit 0`；Build output directory 填 `/`，Root directory 保持默认。仓库根目录就是站点根目录。推送到 `main` 后自动重新部署。

## 教学模型边界

页面一次只模拟一个初始为 0 的数字量高脉冲。滤波累计按西门子手册规则演示；扫描周期固定，仅用于观察读取时机。滤波时间 0 只用于教学，实际设备需选支持的档位。脉冲捕捉发生在滤波之后，无法找回已被滤掉的脉冲。页面数值不用于现场设备选型或参数设定。

资料：[西门子数字输入滤波](https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/device-configuration/configuring-the-operation-of-the-cpu/configuring-digital-input-filter-times) · [西门子脉冲捕捉](https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/device-configuration/configuring-the-operation-of-the-cpu/pulse-catch?contentId=4ilY9cFiW_IEbv7OrAb9tg)

字体授权见 `fonts/OFL.txt`。
