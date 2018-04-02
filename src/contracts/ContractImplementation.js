import contract from 'truffle-contract'
import _ from 'lodash'

import isRequired from '../utils/isRequired'
import * as errorConstants from '../constants/error'
import Web3Wrapper from '../utils/Web3Wrapper'

class ContractImplementation {
  constructor(
    web3Provider = isRequired('web3Provider'),
    contractAddress = isRequired('contractAddress'),
    artifact = isRequired('artifact')
  ) {
    this.contractAddress = contractAddress
    this.artifact = artifact
    this.contractInstance = null
    this._Web3Wrapper = new Web3Wrapper(web3Provider)
    // loading params
    // NOTE it does not load on init because catching async errors is super messy
    this._contractLoadedResolver = null
    this._contractLoadedRejecter = null
    this._loadingContractInstance = null
    this.isLoading = false
  }

  /**
   * Load contract instance if not yet initialized. Returns loading promise
   * @returns {Promise} resolves to contractInstance
   */
  loadContract = async () => {
    if (this.isLoading) return this._loadingContractInstance
    if (this.contractInstance) return this.contractInstance

    const newLoadingPromise = this._newLoadingPromise()
    this._loadingContractInstance = newLoadingPromise
    this._load()
    return newLoadingPromise
  }

  /**
   * Set a new contract instance
   * @param {string} contractAddress - The address of the contract
   * @param {object} artifact - Contract artifact to use to load contract
   * @returns {object} contractInstance object
   */
  setContractInstance = async (
    contractAddress = this.contractAddress,
    artifact = this.artifact
  ) => {
    this.contractAddress = contractAddress
    this.artifact = artifact
    this.contractInstance = null
    return this.loadContract()
  }

  /**
   * Load an existing contract from the current artifact and address
   */
  _load = async () => {
    this.isLoading = true
    try {
      this.contractInstance = await this._instantiateContractIfExistsAsync(
        this.artifact,
        this.contractAddress
      )

      this.isLoading = false
      this._contractLoadedResolver(this.contractInstance)
    } catch (err) {
      this.isLoading = false
      this._contractLoadedRejecter(err)
    }
  }

  /**
   * Instantiate contract.
   * @private
   * @param {object} artifact - The contract artifact.
   * @param {string} address - The hex encoded contract Ethereum address
   * @returns {object} - The contract instance.
   */
  _instantiateContractIfExistsAsync = async (artifact, address) => {
    try {
      const c = await contract(artifact)
      await c.setProvider(await this._Web3Wrapper.getProvider())
      const contractInstance = _.isUndefined(address)
        ? await c.deployed()
        : await c.at(address)

      // Estimate gas before sending transactions
      for (const funcABI of contractInstance.abi) {
        // Check for non-constant functions
        if (funcABI.type === 'function' && funcABI.constant === false) {
          const func = contractInstance[funcABI.name]

          // eslint-disable-next-line no-loop-func
          contractInstance[funcABI.name] = async (...args) => {
            await func.estimateGas(...args) // Estimate gas (also checks for possible failures)
            return func(...args) // Call original function
          }

          // Keep reference to the original function for special cases
          contractInstance[funcABI.name].original = func

          // Forward other accessors to the original function
          Object.setPrototypeOf(contractInstance[funcABI.name], func)
        }
      }

      return contractInstance
    } catch (err) {
      console.error(err)

      if (_.includes(err.message, 'not been deployed to detected network'))
        throw new Error(errorConstants.CONTRACT_NOT_DEPLOYED)

      throw new Error(errorConstants.UNABLE_TO_LOAD_CONTRACT)
    }
  }

  _newLoadingPromise = () =>
    new Promise((resolve, reject) => {
      this._contractLoadedResolver = resolve
      this._contractLoadedRejecter = reject
    })

  getContractAddress = () => this.contractAddress
}

export default ContractImplementation