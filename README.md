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

## testnet 部署（已上线 ton-testnet-v2）

```bash
# 密钥准备：24 词助记词存 .keys/testnet.txt（.gitignore 已覆盖，不入库）
export WALLET_MNEMONIC="$(tr -d '' < .keys/testnet.txt | tr '
' ' ' | sed 's/  */ /g')"
export WALLET_VERSION=v4

npm run build
npx blueprint run --testnet oneAction --mnemonic -- action=jetton       # JettonMaster
npx blueprint run --testnet oneAction --mnemonic -- action=nft          # NftCollection
npx blueprint run --testnet oneAction --mnemonic -- action=business     # IncenseDraw
npx blueprint run --testnet oneAction --mnemonic -- action=setminter    # business 注册为 MERIT minter
npx blueprint run --testnet oneAction --mnemonic -- action=setnftminter # business 注册为 NFT minter
npx blueprint run --testnet oneAction --mnemonic -- action=manifest     # 生成 deploy-manifest-testnet.json
npx blueprint run --testnet smokeIncense --mnemonic                     # 真实上香冒烟
```

部署后把清单交给后端导入：`bin/rails runner`（ChainRegistry::DeploymentManifestImporter.import!），ton-testnet 链即 playable。注意：one-time minter（SetMinter/SetNftMinter 各仅一次），minter 错登记需全组重部署（content URI 加版本后缀换地址）。**不要用 WALLET_VERSION=v5r1**（Blueprint MnemonicProvider v5r1 间歇丢动作——外部消息被接受但零 out 消息）。

## 阻塞与后续

- 3.2–3.6 已落地（sandbox 30 用例全绿）；3.8 testnet 已部署（ton-testnet-v2）
- 7.1 testnet 端到端浏览器验收（Tonkeeper 连接 → 上香 → 求签 → NFT）待用户执行
- 工具链版本锁定见 package.json（Tact 1.6.13 / sandbox 0.45.0 / jest 29.7.0）
