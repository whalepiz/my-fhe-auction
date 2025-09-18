import { ethers, fhevm } from "hardhat";

async function main() {
  const [deployer, alice, bob, charlie] = await ethers.getSigners();

  // Deploy auction demo (5 phút)
  const Auction = await ethers.getContractFactory("FHEAuction");
  const auction = await Auction.deploy("Rare NFT #1", 300);
  await auction.waitForDeployment();
  const addr = await auction.getAddress();
  console.log("Auction deployed at:", addr);

  // 🔑 QUAN TRỌNG: khởi tạo FHEVM mock cho contract khi chạy trên localhost
  await fhevm.assertCoprocessorInitialized(auction, "FHEAuction");

  // Alice bid = 10
  {
    const encA = await fhevm.createEncryptedInput(addr, alice.address).add32(10).encrypt();
    await (await auction.connect(alice).bid(encA.handles[0], encA.inputProof)).wait();
  }

  // Bob bid = 22 (dự kiến thắng)
  {
    const encB = await fhevm.createEncryptedInput(addr, bob.address).add32(22).encrypt();
    await (await auction.connect(bob).bid(encB.handles[0], encB.inputProof)).wait();
  }

  // Charlie bid = 15
  {
    const encC = await fhevm.createEncryptedInput(addr, charlie.address).add32(15).encrypt();
    await (await auction.connect(charlie).bid(encC.handles[0], encC.inputProof)).wait();
  }

  const [, end] = await auction.getStatus();
  console.log("Bidding ends at (unix):", end.toString());
  console.log("Seeded bids: Alice=10, Bob=22, Charlie=15");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
