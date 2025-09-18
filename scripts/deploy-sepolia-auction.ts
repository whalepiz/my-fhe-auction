import { ethers } from "hardhat";

async function main() {
  // Chỉnh thông số tuỳ ý
  const ITEM = "Rare NFT #1";
  const DURATION = 300; // giây

  const F = await ethers.getContractFactory("FHEAuction");
  const auction = await F.deploy(ITEM, DURATION);
  await auction.waitForDeployment();
  console.log("FHEAuction deployed to:", await auction.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });
