import Onboard, { OnboardAPI } from '@web3-onboard/core'
import injectedModule from '@web3-onboard/injected-wallets'
import walletConnectModule from '@web3-onboard/walletconnect'
import coinbaseModule from '@web3-onboard/coinbase'
import { ethers } from 'ethers'

type ConnectResult = {
  address: string
  provider: any
}

let onboard: OnboardAPI | null = null
let ethersProvider: ethers.providers.Web3Provider | null = null
let ethersSigner: ethers.Signer | null = null
let connectedAddress: string | null = null

function init() {
  if (onboard) return onboard
  const injected = injectedModule()
  const walletConnect = walletConnectModule({
    projectId: 'c0c838fac0cbe5b43ad76ea8652e3029'
  })
  const coinbase = coinbaseModule()
  onboard = Onboard({
    wallets: [injected, walletConnect, coinbase],
    chains: [
      {
        id: '0x2105',
        token: 'ETH',
        label: 'Base',
        rpcUrl: 'https://mainnet.base.org'
      }
    ],
    accountCenter: {
      desktop: { enabled: false },
      mobile: { enabled: false }
    }
  })

  onboard.state.select('wallets').subscribe(wallets => {
    if (wallets.length > 0) {
      const w = wallets[0]
      const provider = w.provider
      ethersProvider = new ethers.providers.Web3Provider(provider)
      ethersSigner = ethersProvider.getSigner()
      connectedAddress = w.accounts[0]?.address || null
    } else {
      ethersProvider = null
      ethersSigner = null
      connectedAddress = null
    }
  })

  return onboard
}

async function connect(): Promise<ConnectResult | null> {
  const ob = init()
  const wallets = await ob.connectWallet()
  if (!wallets || wallets.length === 0) return null
  const w = wallets[0]
  return { address: w.accounts[0].address, provider: w.provider }
}

async function disconnect() {
  if (!onboard) return
  const wallets = onboard.state.get().wallets
  if (wallets.length > 0) {
    await onboard.disconnectWallet({ label: wallets[0].label })
  }
}

function getSigner() { return ethersSigner }
function getProvider() { return ethersProvider }
function getAddress() { return connectedAddress }

// Re-export as named exports so esbuild IIFE puts them on window.Web3OnboardBridge
export { init, connect, disconnect, getSigner, getProvider, getAddress }


