import _ from 'lodash'

import ContractImplementation from '../../ContractImplementation'
import EventListener from '../../../utils/EventListener'
import httpRequest from '../../../utils/httpRequest'

/**
 * Provides interaction with standard Arbitrable contracts
 */
class Arbitrable extends ContractImplementation {
  /**
   * Constructor ArbitrableTransaction.
   * @param {object} web3Provider instance
   * @param {string} contractAddress of the contract
   */
  constructor(web3Provider, contractArtifact, contractAddress) {
    super(web3Provider, contractArtifact, contractAddress)
  }

  /**
   * Get the meta evidence for the contract. Arbitrable Transaction can only have
   * one meta-evidence that is submitted on contract creation. Look up meta-evidence event
   * and make an http request to the resource.
   */
  getMetaEvidence = async () => {
    const metaEvidenceLog = await EventListener.getEventLogs(
      this,
      'MetaEvidence',
      0,
      'latest',
      { _metaEvidenceID: 0 }
    )

    if (!metaEvidenceLog[0]) return {} // NOTE better to throw errors for missing meta-evidence?

    const metaEvidenceUri = metaEvidenceLog[0].args._evidence
    // FIXME caching issue need a query param to fetch from AWS
    const metaEvidenceResponse = await httpRequest(
      'GET',
      metaEvidenceUri + '?nocache'
    )

    if (metaEvidenceResponse.status >= 400)
      throw new Error(`Unable to fetch meta-evidence at ${metaEvidenceUri}`)
    return metaEvidenceResponse.body || metaEvidenceResponse
  }

  /**
   * Get the evidence submitted in a dispute.
   */
  getEvidence = async () => {
    await this.loadContract()
    const arbitratorAddress = await this.contractInstance.arbitrator()
    await this.loadContract()
    const disputeId = (await this.contractInstance.disputeID()).toNumber()

    // No evidence yet as there is no dispute
    if (_.isNull(disputeId)) return []

    const evidenceLogs = await EventListener.getEventLogs(
      this,
      'Evidence',
      0,
      'latest',
      { _disputeID: disputeId, _arbitrator: arbitratorAddress }
    )

    // TODO verify hash and data are valid if hash exists
    return Promise.all(
      evidenceLogs.map(async evidenceLog => {
        const evidenceURI = evidenceLog.args._evidence
        const evidence = await httpRequest('GET', evidenceURI)
        const submittedAt = (await this._Web3Wrapper.getBlock(
          evidenceLog.blockNumber
        )).timestamp
        return {
          ...evidence.body,
          ...{ submittedBy: evidenceLog.args._party, submittedAt }
        }
      })
    )
  }

  /**
   * Fetch all standard contract data.
   */
  getContractData = async () => {
    await this.loadContract()

    const [metaEvidence, partyA, partyB] = await Promise.all([
      this.getMetaEvidence(),
      this.contractInstance.partyA(),
      this.contractInstance.partyB()
    ])

    return {
      partyA,
      partyB,
      metaEvidence
    }
  }
}

export default Arbitrable
