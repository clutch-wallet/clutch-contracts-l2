import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { Wallet } from "@ethersproject/wallet";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ClutchWallet, ClutchWallet__factory, Greeter } from "../typechain";

interface ISignedMessage {
  to?: string;
  value?: BigNumberish;
  data: BytesLike;
  nonce?: BigNumberish;
}

describe("ClutchWallet", () => {
  const signer = ethers.Wallet.createRandom();
  const guardian = ethers.Wallet.createRandom();
  const thirdParty = ethers.Wallet.createRandom();

  let deployer: SignerWithAddress;
  let ClutchWallet: ClutchWallet__factory;
  let wallet: ClutchWallet;
  let greeter: Greeter;
  let selectors = {
    changeSigner: "",
    changeGuardian: "",
    triggerEscape: "",
    cancelEscape: "",
    escapeSigner: "",
    escapeGuardian: "",
  };

  const getSignatures = async (signers: Wallet[], { to, value = 0, data, nonce }: ISignedMessage) => {
    if (typeof to === "undefined") {
      to = wallet.address;
    }
    if (typeof nonce === "undefined") {
      nonce = await wallet.nonce();
    }
    const messageHex = await wallet.getSignedMessage(to, value, data, nonce);
    const messageBytes = ethers.utils.arrayify(messageHex);
    const signatures = signers.map((signer) => signer.signMessage(messageBytes))
    return Promise.all(signatures);
  }

  before(async () => {
    [deployer] = await ethers.getSigners();
    ClutchWallet = await ethers.getContractFactory("ClutchWallet");
    selectors = Object.fromEntries(Object.keys(selectors).map((method) => [method, ClutchWallet.interface.getSighash(method)])) as any;

    const GreeterContract = await ethers.getContractFactory("Greeter");
    greeter = await GreeterContract.deploy("Hello");
  });

  beforeEach(async () => {
    wallet = await ClutchWallet.deploy(signer.address, guardian.address);
  });

  it("should be in initial state", async () => {
    expect(await wallet.nonce()).to.equal(0);
    expect(await wallet.escape()).to.deep.equal([BigNumber.from(0), ethers.constants.AddressZero]);
  });

  it("should receive value", async () => {
    const balanceBefore = await ethers.provider.getBalance(wallet.address);
    await deployer.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });
    const balanceAfter = await ethers.provider.getBalance(wallet.address);
    expect(balanceAfter.gt(balanceBefore)).to.be.true;
  });

 it("should execute a transaction", async () => {
    const to = greeter.address;
    const data = greeter.interface.encodeFunctionData("setGreeting", ["Hola"]);

    const [signerSignature, guardianSignature, thirdPartySignature] = await getSignatures(
      [signer, guardian, thirdParty],
      { to, data }
    );

    // failures cases
    await expect(wallet.execute(ethers.constants.AddressZero, 0, data, signerSignature, guardianSignature, 0)).to.be.revertedWith("null _to");
    await expect(wallet.execute(to, 0, data, signerSignature, guardianSignature, 1)).to.be.revertedWith("invalid nonce");
    await expect(wallet.execute(to, 0, data, signerSignature, thirdPartySignature, 0)).to.be.revertedWith("invalid signature");
    await expect(wallet.execute(to, 0, data, thirdPartySignature, guardianSignature, 0)).to.be.revertedWith("invalid signature");
    await expect(wallet.execute(to, 0, data, "0x", "0x", 0)).to.be.revertedWith("invalid signature");

    // success case
    expect(await greeter.greet()).to.equal("Hello");
    await wallet.execute(to, 0, data, signerSignature, guardianSignature, 0);
    expect(await greeter.greet()).to.equal("Hola");
    expect(await wallet.nonce()).to.equal(1);
  });

  it("should execute a transaction with value", async () => {
    await deployer.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });

    const to = greeter.address;
    const data = greeter.interface.encodeFunctionData("greetWithGift");

    const value = ethers.utils.parseEther("0.1");
    const [signerSignature, guardianSignature] = await getSignatures([signer, guardian], { to, value, data });

    const balanceBefore = await ethers.provider.getBalance(wallet.address);
    await wallet.execute(to, value, data, signerSignature, guardianSignature, 0);
    const balanceAfter = await ethers.provider.getBalance(wallet.address);
    expect(balanceAfter.lt(balanceBefore)).to.be.true;
  });

  it("should change signer", async () => {
    const newSigner = ethers.Wallet.createRandom();

    const [signerSignature, guardianSignature, thirdPartySignature] = await getSignatures(
      [signer, guardian, thirdParty],
      { data: ethers.utils.hexConcat([selectors.changeSigner, newSigner.address]) },
    );

    // failures cases
    await expect(wallet.changeSigner(ethers.constants.AddressZero, signerSignature, guardianSignature, 0)).to.be.revertedWith("null _newSigner");
    await expect(wallet.changeSigner(newSigner.address, signerSignature, guardianSignature, 1)).to.be.revertedWith("invalid nonce");
    await expect(wallet.changeSigner(newSigner.address, signerSignature, thirdPartySignature, 0)).to.be.revertedWith("invalid signature");

    // success case
    expect(await wallet.callStatic["signer"]()).to.equal(signer.address);
    await expect(wallet.changeSigner(newSigner.address, signerSignature, guardianSignature, 0)).to.not.be.reverted;
    expect(await wallet.callStatic["signer"]()).to.equal(newSigner.address);
    expect(await wallet.nonce()).to.equal(1);
  });

  it("should change guardian", async () => {
    const newGuardian = ethers.Wallet.createRandom();

    const [signerSignature, guardianSignature, thirdPartySignature] = await getSignatures(
      [signer, guardian, thirdParty],
      { data: ethers.utils.hexConcat([selectors.changeGuardian, newGuardian.address]) },
    );

    // failures cases
    await expect(wallet.changeSigner(ethers.constants.AddressZero, signerSignature, guardianSignature, 0)).to.be.revertedWith("null _newSigner");
    await expect(wallet.changeSigner(newGuardian.address, signerSignature, guardianSignature, 1)).to.be.revertedWith("invalid nonce");
    await expect(wallet.changeSigner(newGuardian.address, signerSignature, thirdPartySignature, 0)).to.be.revertedWith("invalid signature");

    // success case
    expect(await wallet.guardian()).to.equal(guardian.address);
    await wallet.changeGuardian(newGuardian.address, signerSignature, guardianSignature, 0);
    expect(await wallet.guardian()).to.equal(newGuardian.address);
    expect(await wallet.nonce()).to.equal(1);
  });

  it("should trigger signer escape", async () => {
    const [signerSignature, guardianSignature, thirdPartySignature] = await getSignatures(
      [signer, guardian, thirdParty],
      { data: ethers.utils.hexConcat([selectors.triggerEscape, signer.address]) },
    );

    // failures cases
    await expect(wallet.triggerEscape(signer.address, guardianSignature, 0)).to.be.revertedWith("invalid signature");
    await expect(wallet.triggerEscape(signer.address, thirdPartySignature, 0)).to.be.revertedWith("invalid signature");

    const { timestamp } = await ethers.provider.getBlock(ethers.provider.getBlockNumber());

    await wallet.triggerEscape(signer.address, signerSignature, 0);
    const escapeSecurityPeriod = await wallet.ESCAPE_SECURITY_PERIOD();
    const [escapeAt, caller] = await wallet.escape();
    expect(escapeAt.gte(escapeSecurityPeriod.add(timestamp))).to.be.true;
    expect(caller).to.equal(signer.address);
  });

  // TODO: trigger guardian escape

  it("should cancel signer escape", async () => {
    let signerSignature, guardianSignature;

    [signerSignature] = await getSignatures([signer], { data: ethers.utils.hexConcat([selectors.triggerEscape, signer.address]) });
      
    await wallet.triggerEscape(signer.address, signerSignature, 0);

    [signerSignature, guardianSignature] = await getSignatures(
      [signer, guardian], 
      { data: ethers.utils.hexConcat([selectors.cancelEscape, "0x"]) },
    );
    await wallet.cancelEscape(signerSignature, guardianSignature, 1);
  });

  it("should escape signer", async () => {
    const newSigner = ethers.Wallet.createRandom();
    let guardianSignature;

    [guardianSignature] = await getSignatures([guardian], { data: ethers.utils.hexConcat([selectors.triggerEscape, guardian.address]) });
    await wallet.triggerEscape(guardian.address, guardianSignature, 0);

    // advance time
    const [escapeAt] = await wallet.escape();
    await ethers.provider.send("evm_setNextBlockTimestamp", [escapeAt.toNumber()]); 
    await ethers.provider.send("evm_mine", []);

    // success case
    [guardianSignature] = await getSignatures([guardian], { data: ethers.utils.hexConcat([selectors.escapeSigner, newSigner.address]) });
    await wallet.escapeSigner(newSigner.address, guardianSignature, 1);
    expect(await wallet.callStatic["signer"]()).to.equal(newSigner.address);
    expect(await wallet.escape()).to.deep.equal([BigNumber.from(0), ethers.constants.AddressZero]);
  });

  // TODO: escape guardian

});
