import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "solidity-coverage";
import * as dotenv from "dotenv";

import "./tasks/accounts";
import "./tasks/FHECounter";

// Load .env (fallback cho hardhat vars)
dotenv.config();

/**
 * Ưu tiên lấy từ `hardhat vars`, nếu không có thì dùng .env
 * - npx hardhat vars set MNEMONIC / INFURA_API_KEY / ETHERSCAN_API_KEY (tuỳ bạn)
 */
const MNEMONIC: string = vars.get(
  "MNEMONIC",
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk",
);

const INFURA_API_KEY: string = vars.get(
  "INFURA_API_KEY",
  process.env.INFURA_API_KEY ?? "",
);

const ETHERSCAN_API_KEY: string = vars.get(
  "ETHERSCAN_API_KEY",
  process.env.ETHERSCAN_API_KEY ?? "",
);

// Nếu bạn thích dùng PRIVATE_KEY thay vì mnemonic, đặt trong .env
const PRIVATE_KEY: string = vars.get("PRIVATE_KEY", process.env.PRIVATE_KEY ?? "");

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",

  namedAccounts: {
    deployer: 0,
  },

  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },

  gasReporter: {
    currency: "USD",
    enabled: !!process.env.REPORT_GAS,
    excludeContracts: [],
  },

  networks: {
    hardhat: {
      accounts: { mnemonic: MNEMONIC },
      chainId: 31337,
    },

    // JSON-RPC local (hardhat node)
    localhost: {
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },

    // Tuỳ chọn: anvil
    anvil: {
      accounts: { mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10 },
      chainId: 31337,
      url: "http://localhost:8545",
    },

    // Sepolia (ưu tiên PRIVATE_KEY; nếu không có sẽ dùng MNEMONIC)
    sepolia: {
      chainId: 11155111,
      url:
        process.env.SEPOLIA_RPC_URL ||
        (INFURA_API_KEY ? `https://sepolia.infura.io/v3/${INFURA_API_KEY}` : "https://eth-sepolia.public.blastapi.io"),
      accounts: PRIVATE_KEY
        ? [PRIVATE_KEY]
        : { mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10 },
    },
  },

  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },

  solidity: {
    version: "0.8.27",
    settings: {
      metadata: { bytecodeHash: "none" },
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },

  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
