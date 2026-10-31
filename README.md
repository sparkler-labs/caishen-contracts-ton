# caishen-contracts-ton

赛博财神 TON 链合约（add-ton-chain-support 提案）：MERIT Jetton（TEP-74）、
签文 NFT（TEP-62）与上香/求签主业务合约。Tact 1.6 编译。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按 package-lock.json 可复现安装（Node 24 实测） |
| `npm run build` | Tact 编译全部项目（jetton / nft / business），产物在 `output/` |
| `npm test` | @ton/sandbox 链上模拟测试（jest 单进程） |

## 结构

- `contracts/jetton.tact`：TEP-74 Jetton Master/Wallet（3.2 完善授权铸造规则面）
- `contracts/nft.tact`：TEP-62 NFT Collection/Item（3.3 完善授权铸造与标准转移）
- `contracts/business.tact`：上香/求签主业务合约（3.4–3.6 落地 query_id 消息协议、
  规则校验、签号与 resume_draw 恢复；骨架期仅存储与 getter）
- `tests/smoke.spec.ts`：工具链冒烟（部署 + getter）

## 阻塞与后续

- 3.2–3.6 按任务逐条落地业务规则与测试；3.8 testnet 部署与版本化清单
- 工具链版本锁定见 package.json（Tact 1.6.13 / sandbox 0.45.0 / jest 29.7.0）
