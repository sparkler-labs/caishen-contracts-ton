// MERIT Jetton（TEP-74）——add-ton-chain-support 3.1 骨架。
// 3.2 完善面：授权铸造的规则面（与主业务合约联动）、精度在部署清单固定的取值、
// 8 MERIT 最小单位计算用例；本骨架提供可编译的标准消息面与 getter。

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

message(0x642b7d07) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forwardPayload: Slice as remaining;
}

// 部署清单（3.8）固定的铸造授权入口：骨架期仅 admin 可铸，3.2 接入主业务
// 合约地址白名单（design D4：NFT Collection 与 Jetton 铸造都由主业务合约驱动）。
message Mint {
    queryId: Int as uint64;
    receiver: Address;
    amount: Int as coins;
}

contract JettonMaster {
    totalSupply: Int as coins;
    owner: Address;
    content: Cell;
    maxSupply: Int as coins;

    init(owner: Address, content: Cell, maxSupply: Int) {
        self.totalSupply = 0;
        self.owner = owner;
        self.content = content;
        self.maxSupply = maxSupply;
    }

    // 授权铸造（3.2 完善）：总量守恒、maxSupply 上限、主业务合约白名单。
    receive(msg: Mint) {
        require(context().sender == self.owner, "Unauthorized mint");
        require(self.totalSupply + msg.amount <= self.maxSupply, "Max supply exceeded");
        self.totalSupply = self.totalSupply + msg.amount;
        send(SendParameters {
            to: self.jettonWalletAddress(msg.receiver),
            value: 0,
            bounce: false,
            code: initOf JettonWallet(msg.amount, msg.receiver, myAddress()).code,
            data: initOf JettonWallet(msg.amount, msg.receiver, myAddress()).data,
            body: TokenNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                from: myAddress(),
                forwardPayload: emptySlice(),
            }.toCell(),
        });
    }

    receive(msg: TokenBurnNotification) {
        require(context().sender == self.jettonWalletAddress(msg.from), "Unauthorized burn notification");
        self.totalSupply = self.totalSupply - msg.amount;
        self.cashback(msg.responseAddress);
    }

    receive(msg: TokenExcesses) {
        self.cashback(sender());
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, bounce: false, body: TokenExcesses{ queryId: 0 }.toCell() });
        }
    }

    // TEP-89：由 master 推导用户 Jetton Wallet 地址（4.1 后端派生入口的对端）。
    fun jettonWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(0, owner, myAddress()));
    }

    get fun get_jetton_data(): JettonData {
        return JettonData {
            totalSupply: self.totalSupply,
            maxSupply: self.maxSupply,
            mintable: true,
            owner: self.owner,
            content: self.content,
            walletCode: initOf JettonWallet(0, self.owner, myAddress()).code,
        };
    }

    get fun get_wallet_address(owner: Address): Address {
        return self.jettonWalletAddress(owner);
    }
}

message(0x7362d09c) TokenBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    responseAddress: Address?;
}

contract JettonWallet {
    balance: Int as coins;
    owner: Address;
    master: Address;

    init(balance: Int, owner: Address, master: Address) {
        self.balance = balance;
        self.owner = owner;
        self.master = master;
    }

    receive(msg: TokenTransfer) {
        require(context().sender == self.owner, "Unauthorized transfer");
        require(self.balance >= msg.amount, "Insufficient balance");
        self.balance = self.balance - msg.amount;
        send(SendParameters {
            to: msg.destination,
            value: 0,
            bounce: true,
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
        require(context().sender == self.jettonWalletAddress(msg.from), "Unauthorized internal transfer");
        self.balance = self.balance + msg.amount;
        if (msg.forwardTonAmount > 0) {
            send(SendParameters {
                to: self.owner,
                value: 0,
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
            send(SendParameters { to: to!!, value: 0, bounce: false, body: TokenExcesses{ queryId: 0 }.toCell() });
        }
    }

    fun jettonWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(0, owner, self.master));
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            master: self.master,
            walletCode: initOf JettonWallet(0, self.owner, self.master).code,
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
