import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("Auction demo (deploy → seed → settle → decrypt)", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  before(async () => {
    const s = await ethers.getSigners();
    deployer = s[0];
    alice    = s[1];
    bob      = s[2];
    charlie  = s[3] ?? s[2];
  });

  it("runs full flow and decrypts winning bid & index", async () => {
    // 1) Deploy auction 60s
    const Auction = await ethers.getContractFactory("FHEAuction");
    const auction = await Auction.deploy("Rare NFT #1", 60);
    await auction.waitForDeployment();
    const addr = await auction.getAddress();
    console.log("Auction:", addr);

    // 2) Seed 3 bids (A=10, B=22, C=15) — encrypt theo pattern FHECounter
    {
      const encA = await fhevm.createEncryptedInput(addr, alice.address).add32(10).encrypt();
      await (await auction.connect(alice).bid(encA.handles[0], encA.inputProof)).wait();
    }
    {
      const encB = await fhevm.createEncryptedInput(addr, bob.address).add32(22).encrypt();
      await (await auction.connect(bob).bid(encB.handles[0], encB.inputProof)).wait();
    }
    {
      const encC = await fhevm.createEncryptedInput(addr, charlie.address).add32(15).encrypt();
      await (await auction.connect(charlie).bid(encC.handles[0], encC.inputProof)).wait();
    }

    // 3) Tua thời gian quá hạn, rồi settle
    await ethers.provider.send("evm_increaseTime", [70]);
    await ethers.provider.send("evm_mine", []);
    await (await auction.connect(deployer).settle([alice.address, bob.address, charlie.address])).wait();

    // 4) Lấy kết quả mã hoá và decrypt off-chain (deployer được allow trong contract)
    const winningBidEnc = await auction.winningBidEnc();
    const winningIdxEnc = await auction.winningIndexEnc();

    const winningBidClear = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      winningBidEnc,
      addr,
      deployer
    );
    const winningIdxClear = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      winningIdxEnc,
      addr,
      deployer
    );

    console.log("Winning bid (clear):", winningBidClear);
    console.log("Winning index (clear):", winningIdxClear);

    // 5) Kiểm tra đúng người thắng (B=22 nằm ở index 1 trong [A,B,C])
    expect(winningBidClear).to.eq(22);
    expect(winningIdxClear).to.eq(1);
  });
});

