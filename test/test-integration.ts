import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ClutchWallet, ClutchWallet__factory, EntryPoint, EntryPoint__factory, TestCounter, TestCounter__factory } from "../typechain";
import { AASigner, localUserOpSender, rpcUserOpSender, SendUserOp } from "../scripts/lib/AASigner";
import { objdump } from "../scripts/lib/testutils";
import { deployAll } from "../scripts/deploy";

describe("ClutchWallet", () => {
  let deployer: SignerWithAddress;
  let signer: SignerWithAddress;
  let guardian: SignerWithAddress;
  let thirdParty: SignerWithAddress;

  let ClutchWallet: ClutchWallet__factory;
  let wallet: ClutchWallet;
  let testCounter: TestCounter;
  let selectors = {
    changeSigner: "",
    changeGuardian: "",
    triggerEscape: "",
    cancelEscape: "",
    escapeSigner: "",
    escapeGuardian: "",
  };

  let currentStake = "";
  let entryPoint: EntryPoint;

  before(async () => {
    console.log(`using network ${hre.network.name}`);

    [deployer, signer, guardian, thirdParty] = await ethers.getSigners();
    console.log(`deployer ${deployer.address}`);
    console.log(`signer ${signer.address}`);
    console.log(`guardian ${guardian.address}`);
    ClutchWallet = await ethers.getContractFactory("ClutchWallet");
    selectors = Object.fromEntries(Object.keys(selectors).map((method) => [method, ClutchWallet.interface.getSighash(method)])) as any;

    let sendUserOp: SendUserOp;
    let entryPointAddress, walletAddress, testCounterAddress;

    if (hre.network.name === "hardhat") {
      console.log(`deploying ClutchWallet`);
      ({ entryPointAddress, walletAddress, testCounterAddress } = await deployAll({
        from: deployer, 
        signer: signer.address, 
        guardian: guardian.address,
      }));

      // hre.run("deploy", { signerAddress: signer.address, guardianAddress: guardian.address });
      // wallet = await ClutchWallet.deploy(...args);
      // await wallet.deployed();

      sendUserOp = localUserOpSender(entryPointAddress, deployer);
    } else {
      entryPointAddress = "0xF63621e54F16eC6e4A732e44EaA7708935f259eF";
      walletAddress = "0x15A83ceCCBC597F4E882596f7aEe28793Ca23Ea3";
      testCounterAddress = "0x4B52ceEDE2e695CAeDBC1Cc8E7f9d5Ef18F0EeF5";
      // console.log(`verifying etherscan`);
      // const args = [signer.address, guardian.address, entryPointAddress] as const;
      // await hre.run("verify:verify", { address: wallet.address, constructorArguments: args });

      sendUserOp = rpcUserOpSender(new ethers.providers.JsonRpcProvider(process.env.AA_URL));
    }
    console.log(`ClutchWallet at ${walletAddress}`)

    const aaSigner = new AASigner([signer, guardian], entryPointAddress, sendUserOp);
    console.log(`connecting wallet address`)
    await aaSigner.connectWalletAddress(walletAddress)
    if (await ethers.provider.getBalance(walletAddress) < ethers.utils.parseEther("0.01")) {
      console.log("prefund wallet")
      await deployer.sendTransaction({to: walletAddress, value: ethers.utils.parseEther("0.01")})
      console.log("funded")
    }

    //usually, a wallet will deposit for itself (that is, get created using eth, run "addDeposit" for itself
    // and from there on will use deposit
    // for testing,
    entryPoint = EntryPoint__factory.connect(entryPointAddress, deployer)
    wallet = ClutchWallet__factory.connect(walletAddress, aaSigner)
    testCounter = TestCounter__factory.connect(testCounterAddress, aaSigner)

    const info = await entryPoint.getStakeInfo(wallet.address)
    currentStake = info.stake.toString()
    console.log("current stake=", currentStake)

    if (info.stake.lte(ethers.utils.parseEther("0.01"))) {
      console.log("depositing for wallet")
      entryPoint.addDepositTo(wallet.address, {value: ethers.utils.parseEther("0.01")})
    }

  });

  beforeEach(async () => {
    // wallet = await ClutchWallet.deploy(signer.address, guardian.address, ethers.constants.AddressZero);
  });

  it("should increment the counter", async () => {
    const prebalance = await ethers.provider.getBalance(wallet.address)
    console.log("current counter=", await testCounter.counters(wallet.address), "balance=", prebalance, "stake=", currentStake)
    const ret = await testCounter.count()
    console.log("waiting for mine, tmp.hash=", ret.hash)
    const receipt = await ret.wait()
    console.log("rcpt", receipt.transactionHash, `https://dashboard.tenderly.co/tx/goerli/${receipt.transactionHash}/gas-usage`)
    let gasPaid = prebalance.sub(await ethers.provider.getBalance(wallet.address))
    console.log("counter after=", await testCounter.counters(wallet.address), "paid=", gasPaid.toNumber() / 1e9, "gasUsed=", receipt.gasUsed)
    const logs = await entryPoint.queryFilter("*" as any, receipt.blockNumber)
    console.log(logs.map((e:any)=>({ev:e.event, ...objdump(e.args!)})))
  });

  it.only("should change the signer", async () => {
    const newSigner = ethers.Wallet.createRandom();
    const prebalance = await ethers.provider.getBalance(wallet.address)
    console.log("current signer=", await wallet.callStatic["signer"]());
    console.log("new signer=", newSigner.address);
    const ret = await wallet.changeSigner(newSigner.address)
    console.log("waiting for mine, tmp.hash=", ret.hash)
    const receipt = await ret.wait()
    console.log("rcpt", receipt.transactionHash)
    let gasPaid = prebalance.sub(await ethers.provider.getBalance(wallet.address))
    console.log("signer after=", await wallet.callStatic["signer"](), "paid=", gasPaid.toNumber() / 1e9, "gasUsed=", receipt.gasUsed)
    const logs = await entryPoint.queryFilter("*" as any, receipt.blockNumber)
    console.log(logs.map((e:any)=>({ev:e.event, ...objdump(e.args!)})))
  });

});
