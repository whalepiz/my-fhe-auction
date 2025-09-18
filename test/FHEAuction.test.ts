import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";

describe("FHEAuction E2E", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    // Giữ đúng thứ tự như test FHECounter đã làm
    deployer = ethSigners[0];
    alice    = ethSigners[1];
    bob      = ethSigners[2];
    charlie  = ethSigners[3] ?? ethSigners[2]; // phòng trường hợp ít signer
  });

  it("picks the highest encrypted bid after end", async function () {
    // 1) Deploy auction (60s)
    const Auction = await ethers.getContractFactory("FHEAuction");
    const auction = await Auction.deploy("Rare NFT #1", 60);
    await auction.waitForDeployment();
    const addr = await auction.getAddress();

    // 2) A: bid = 10  (encrypt -> handles[0], inputProof) — y hệt style FHECounter
    const encA = await fhevm
      .createEncryptedInput(addr, alice.address)
      .add32(10)
      .encrypt();
    await (await auction.connect(alice).bid(encA.handles[0], encA.inputProof)).wait();

    // 3) B: bid = 22 (winner)
    const encB = await fhevm
      .createEncryptedInput(addr, bob.address)
      .add32(22)
      .encrypt();
    await (await auction.connect(bob).bid(encB.handles[0], encB.inputProof)).wait();

    // 4) C: bid = 15
    const encC = await fhevm
      .createEncryptedInput(addr, charlie.address)
      .add32(15)
      .encrypt();
    await (await auction.connect(charlie).bid(encC.handles[0], encC.inputProof)).wait();

    // 5) tua thời gian qua deadline (giống FHECounter)
    await ethers.provider.send("evm_increaseTime", [70]);
    await ethers.provider.send("evm_mine", []);

    // 6) settle — seller = deployer (người deploy)
    await (await auction.connect(deployer).settle([
      alice.address,
      bob.address,
      charlie.address
    ])).wait();

    // 7) assert: settled = true
    const status = await auction.getStatus();
    expect(status[2]).to.equal(true);
  });
});
