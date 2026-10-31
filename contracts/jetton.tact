// MERIT Jetton（TEP-74）——add-ton-chain-support 3.2。
// 设计定案（design D4）：精度由部署清单固定并以 init 参数传入、getter 暴露，
// 业务统一按最小单位计算（求签消耗 8 MERIT = 8 * 10^decimals）；授权铸造 =
// admin 与主业务合约（minter，3.4 上香发放 / 3.5 求签消耗的联动入口）。
// 钱包 StateInit 只含 (owner, master)——balance 不进 init，地址推导与部署一致。

message(0x0f8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x17804522) TokenTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    responseAddress: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x595f07bc) TokenBurn {
    queryId: Int as uint64;
    amount: Int as coins;
    responseAddress: Address?;
}

message(0x7bdd97de) TokenExcesses {
    queryId: Int as uint64;
}

message(0x7362d09c) TokenBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    responseAddress: Address?;
}

message(0x642b7d07) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forwardPayload: Slice as remaining;
}

// 授权铸造消息：仅 admin 与 minter（主业务合约）可发。
message Mint {
    queryId: Int as uint64;
    receiver: Address;
    amount: Int as coins;
}

contract JettonMaster {
    totalSupply: Int as coins;
    owner: Address;
    minter: Address;
    content: Cell;
    maxSupply: Int as coins;
    decimals: Int as uint8;

    init(owner: Address, minter: Address, content: Cell, maxSupply: Int, decimals: Int) {
        self.totalSupply = 0;
        self.owner = owner;
        self.minter = minter;
        self.content = content;
        self.maxSupply = maxSupply;
        self.decimals = decimals;
    }

    // 空消息接收：部署与普通转账不抛错
    receive() {}

    fun isAuthorizedMinter(sender: Address): Bool {
        return sender == self.owner || sender == self.minter;
    }

    // 授权铸造：总量守恒、maxSupply 上限；钱包经 internal transfer 部署入账。
    receive(msg: Mint) {
        require(self.isAuthorizedMinter(context().sender), "Unauthorized mint");
        require(self.totalSupply + msg.amount <= self.maxSupply, "Max supply exceeded");
        self.totalSupply = self.totalSupply + msg.amount;
        send(SendParameters {
            to: self.jettonWalletAddress(msg.receiver),
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            bounce: false,
            code: initOf JettonWallet(msg.receiver, myAddress()).code,
            data: initOf JettonWallet(msg.receiver, myAddress()).data,
            body: TokenTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                from: myAddress(),
                responseAddress: null,
                forwardTonAmount: 0,
                forwardPayload: emptySlice(),
            }.toCell(),
        });
    }

    receive(msg: TokenBurnNotification) {
        require(context().sender == self.jettonWalletAddress(msg.from), "Unauthorized burn notification");
        self.totalSupply = self.totalSupply - msg.amount;
        if (msg.responseAddress != null) {
            send(SendParameters {
                to: msg.responseAddress!!,
                value: 0,
            mode: SendPayGasSeparately,
                bounce: false,
                body: TokenExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: TokenExcesses) {
        self.cashback(sender());
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, mode: SendPayGasSeparately, bounce: false, body: TokenExcesses{ queryId: 0 }.toCell() });
        }
    }

    // TEP-89：由 master 推导用户 Jetton Wallet 地址（后端 4.1 派生入口的对端）。
    fun jettonWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(owner, myAddress()));
    }

    get fun get_jetton_data(): JettonData {
        return JettonData {
            totalSupply: self.totalSupply,
            maxSupply: self.maxSupply,
            mintable: true,
            owner: self.owner,
            content: self.content,
            walletCode: initOf JettonWallet(self.owner, myAddress()).code,
        };
    }

    get fun get_wallet_address(owner: Address): Address {
        return self.jettonWalletAddress(owner);
    }

    // 精度暴露（design D4：部署清单固定的值；8 MERIT = 8 * 10^decimals）。
    get fun get_decimals(): Int {
        return self.decimals;
    }
}

contract JettonWallet {
    balance: Int as coins;
    owner: Address;
    master: Address;

    init(owner: Address, master: Address) {
        self.balance = 0;
        self.owner = owner;
        self.master = master;
    }

    // 来源信任：master（铸造/回收）或 msg.from 的派生钱包（标准转移），
    // 绝不信任消息自报 sender（design D5）。
    fun sourceIsTrusted(msgFrom: Address): Bool {
        let sender = context().sender;
        return sender == self.master || sender == self.masterWalletAddress(msgFrom);
    }

    fun masterWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(owner, self.master));
    }

    receive(msg: TokenTransfer) {
        require(context().sender == self.owner, "Unauthorized transfer");
        require(self.balance >= msg.amount, "Insufficient balance");
        self.balance = self.balance - msg.amount;
        send(SendParameters {
            to: msg.destination,
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            bounce: true,
            code: initOf JettonWallet(msg.destination, self.master).code,
            data: initOf JettonWallet(msg.destination, self.master).data,
            body: TokenTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                from: self.owner,
                responseAddress: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
        });
        self.cashback(msg.responseDestination);
    }

    receive(msg: TokenTransferInternal) {
        require(self.sourceIsTrusted(msg.from), "Unauthorized internal transfer");
        self.balance = self.balance + msg.amount;
        if (msg.forwardTonAmount > 0) {
            send(SendParameters {
                to: self.owner,
                value: 0,
            mode: SendPayGasSeparately,
                bounce: false,
                body: TokenNotification {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    from: msg.from,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
        self.cashback(msg.responseAddress);
    }

    receive(msg: TokenBurn) {
        require(context().sender == self.owner, "Unauthorized burn");
        require(self.balance >= msg.amount, "Insufficient balance");
        self.balance = self.balance - msg.amount;
        send(SendParameters {
            to: self.master,
            value: 0,
            mode: SendPayGasSeparately,
            bounce: false,
            body: TokenBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                from: self.owner,
                responseAddress: msg.responseAddress,
            }.toCell(),
        });
    }

    receive(msg: TokenExcesses) {
        self.cashback(sender());
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, mode: SendPayGasSeparately, bounce: false, body: TokenExcesses{ queryId: 0 }.toCell() });
        }
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            master: self.master,
            walletCode: initOf JettonWallet(self.owner, self.master).code,
        };
    }
}

struct JettonData {
    totalSupply: Int;
    maxSupply: Int;
    mintable: Bool;
    owner: Address;
    content: Cell;
    walletCode: Cell;
}

struct JettonWalletData {
    balance: Int;
    owner: Address;
    master: Address;
    walletCode: Cell;
}
