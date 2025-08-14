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
        rpcUrl: 'https://base-rpc.thetanuts.finance'
      }
    ],
    accountCenter: {
      desktop: { enabled: true },
      mobile: { enabled: true }
    },
    theme: {
      '--w3o-background-color': '#1A1D26',
      '--w3o-foreground-color': '#242835',
      '--w3o-text-color': '#EFF1FC',
      '--w3o-border-color': '#33394B',
      '--w3o-action-color': '#929bed',
      '--w3o-border-radius': '0px',
      '--w3o-font-family': 'inherit'
    },
    connect: {
      removeWhereIsMyWalletWarning: true,
      removeIDontHaveAWalletInfoLink: true,
      autoConnectLastWallet: true,
      autoConnectAllPreviousWallet: true,
      showSidebar: false,
    }
  })
  
  // Wait for initial state to settle (including auto-connect attempts)
  onboard.state.select('wallets').subscribe(wallets => {
    if (wallets.length > 0) {
      const w = wallets[0]
      const provider = w.provider
      ethersProvider = new ethers.providers.Web3Provider(provider)
      ethersSigner = ethersProvider.getSigner()
      connectedAddress = w.accounts[0]?.address || null
      
      // Store connection info for auto-reconnect
      if (connectedAddress) {
        localStorage.setItem('lastConnectedWallet', w.label)
        localStorage.setItem('lastConnectedAddress', connectedAddress)
      }
    } else {
      ethersProvider = null
      ethersSigner = null
      connectedAddress = null
    }
  })

  // Monitor available wallets
  onboard.state.select('walletModules').subscribe(walletModules => {
    // Check if injected wallets are available
    const injectedModule = walletModules.find(m => m.label === 'Injected')
    if (injectedModule) {
      // This will help debug if the injected wallet module is working
    }
  })
  
  return onboard
}

async function connect(): Promise<ConnectResult | null> {
  const ob = init()
  
  // Show wallet selection modal without auto-selection
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

async function autoConnect(): Promise<ConnectResult | null> {
  // Check localStorage for previous connections
  const lastWallet = localStorage.getItem('lastConnectedWallet')
  const lastAddress = localStorage.getItem('lastConnectedAddress')
  
  if (!lastWallet || !lastAddress) {
    return null
  }
  
  // Instead of manually calling connect(), let web3-onboard handle auto-connect
  // Just check if we're already connected after initialization
  const ob = init()
  
  // Wait for web3-onboard to fully initialize and attempt auto-connect
  let attempts = 0
  const maxAttempts = 10
  
  while (attempts < maxAttempts) {
    const address = getAddress()
    const provider = getProvider()
    
    if (address && provider) {
      return { address, provider }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500))
    attempts++
  }
  
  return null
}

function getSigner() { return ethersSigner }
function getProvider() { return ethersProvider }
function getAddress() { return connectedAddress }

// Re-export as named exports so esbuild IIFE puts them on window.Web3OnboardBridge
export { init, connect, disconnect, autoConnect, getSigner, getProvider, getAddress }

// Add a test function for debugging
export function testAutoConnect() {
  if (onboard) {
    const state = onboard.state.get()
    return {
      wallets: state.wallets.length,
      connect: state.connect,
      chains: state.chains.length
    }
  } else {
    return null
  }
}


