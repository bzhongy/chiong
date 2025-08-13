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
  console.log('Initializing web3-onboard...')
  
  const injected = injectedModule()
  const walletConnect = walletConnectModule({
    projectId: 'c0c838fac0cbe5b43ad76ea8652e3029'
  })
  const coinbase = coinbaseModule()
  
  console.log('Wallet modules created:', {
    injected: !!injected,
    walletConnect: !!walletConnect,
    coinbase: !!coinbase
  })
  
  console.log('Creating web3-onboard instance with auto-connect enabled...')
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

  console.log('Web3-onboard instance created, setting up state subscription...')
  
  // Wait for initial state to settle (including auto-connect attempts)
  onboard.state.select('wallets').subscribe(wallets => {
    console.log('Web3-onboard state update - wallets:', wallets.length)
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
        console.log('Wallet connected via web3-onboard:', connectedAddress, 'Label:', w.label)
      }
    } else {
      ethersProvider = null
      ethersSigner = null
      connectedAddress = null
      console.log('No wallets connected')
    }
  })

  // Also monitor the connect state
  onboard.state.select('connect').subscribe(connectState => {
    console.log('Web3-onboard connect state:', connectState)
  })
  
  // Monitor available wallets
  onboard.state.select('walletModules').subscribe(walletModules => {
    console.log('Available wallet modules:', walletModules.map(m => m.label))
    
    // Check if injected wallets are available
    const injectedModule = walletModules.find(m => m.label === 'Injected')
    if (injectedModule) {
      console.log('Injected wallet module found, checking for available wallets...')
      // This will help debug if the injected wallet module is working
    }
  })
  
  // Monitor chains state
  onboard.state.select('chains').subscribe(chains => {
    console.log('Available chains:', chains.map(c => ({ id: c.id, label: c.label, rpcUrl: c.rpcUrl })))
  })
  
  // Check if we have any stored connection info
  const storedWallet = localStorage.getItem('lastConnectedWallet')
  const storedAddress = localStorage.getItem('lastConnectedAddress')
  if (storedWallet && storedAddress) {
    console.log('Found stored connection info - Wallet:', storedWallet, 'Address:', storedAddress)
    console.log('Web3-onboard should attempt to auto-connect to this wallet')
    
    // Check if the wallet is actually available in the browser
    if (storedWallet === 'Injected' && typeof (window as any).ethereum !== 'undefined') {
      console.log('MetaMask/Injected wallet detected in browser')
    } else if (storedWallet === 'WalletConnect') {
      console.log('WalletConnect was previously used')
    } else if (storedWallet === 'Coinbase') {
      console.log('Coinbase wallet was previously used')
    } else {
      console.log('Unknown wallet type or wallet not available:', storedWallet)
    }
  } else {
    console.log('No stored connection info found - auto-connect will not be attempted')
  }

  console.log('Web3-onboard initialization complete')
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
  
  console.log('Auto-connect check - Last wallet:', lastWallet, 'Last address:', lastAddress)
  
  if (!lastWallet || !lastAddress) {
    console.log('No previous wallet connection found in localStorage')
    return null
  }
  
  // Instead of manually calling connect(), let web3-onboard handle auto-connect
  // Just check if we're already connected after initialization
  const ob = init()
  
  // Wait for web3-onboard to fully initialize and attempt auto-connect
  console.log('Waiting for web3-onboard auto-connect to complete...')
  
  // Wait longer for web3-onboard to complete auto-connect
  let attempts = 0
  const maxAttempts = 10
  
  while (attempts < maxAttempts) {
    const address = getAddress()
    const provider = getProvider()
    
    if (address && provider) {
      console.log('Auto-connect successful via web3-onboard:', address)
      return { address, provider }
    }
    
    console.log(`Auto-connect attempt ${attempts + 1}/${maxAttempts} - waiting...`)
    await new Promise(resolve => setTimeout(resolve, 500))
    attempts++
  }
  
  console.log('Auto-connect failed - web3-onboard did not auto-connect after maximum attempts')
  return null
}

function getSigner() { return ethersSigner }
function getProvider() { return ethersProvider }
function getAddress() { return connectedAddress }

// Re-export as named exports so esbuild IIFE puts them on window.Web3OnboardBridge
export { init, connect, disconnect, autoConnect, getSigner, getProvider, getAddress }

// Add a test function for debugging
export function testAutoConnect() {
  console.log('=== Testing Auto-Connect ===')
  console.log('LocalStorage state:')
  console.log('- lastConnectedWallet:', localStorage.getItem('lastConnectedWallet'))
  console.log('- lastConnectedAddress:', localStorage.getItem('lastConnectedAddress'))
  
  if (onboard) {
    const state = onboard.state.get()
    console.log('Web3-onboard state:')
    console.log('- wallets:', state.wallets.length)
    console.log('- connect:', state.connect)
    console.log('- chains:', state.chains.length)
  } else {
    console.log('Web3-onboard not initialized')
  }
  
  console.log('=== End Test ===')
}


