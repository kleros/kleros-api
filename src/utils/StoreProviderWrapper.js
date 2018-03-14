import _ from 'lodash'

import PromiseQueue from '../../util/PromiseQueue'

class StoreProviderWrapper {
  constructor(storeProviderUri) {
    this._storeUri = storeProviderUri
    this._storeQueue = new PromiseQueue()
  }

  _makeRequest = (verb, uri, body = null) => {
    const httpRequest = new XMLHttpRequest()
    return new Promise((resolve, reject) => {
      try {
        httpRequest.open(verb, uri, true)
        if (body) {
          httpRequest.setRequestHeader(
            'Content-Type',
            'application/json;charset=UTF-8'
          )
        }
        httpRequest.onreadystatechange = () => {
          if (httpRequest.readyState === 4) {
            let body = null
            try {
              body = JSON.parse(httpRequest.responseText)
              // eslint-disable-next-line no-unused-vars
            } catch (err) {}
            resolve({
              body: body,
              status: httpRequest.status
            })
          }
        }
        httpRequest.send(body)
      } catch (err) {
        reject(err)
      }
    })
  }

  /**
   * use the queue for write request. this allows a function to be passed so we can read immediately before we write
   * @param {fn} getBodyFn async function to call before we write. Should to reads and return JSON to be used as body.
   * @param {string} verb POST or PUT
   * @param {string} uri uri to call
   */
  queueWriteRequest = (getBodyFn, verb, uri = null) => {
    this._storeQueue.push(() =>
      getBodyFn().then(result => {
        this._makeRequest(verb, uri, result)})
    )
  }

  /**
   * If we know we are waiting on some other write before we want to read we can add a read request to the end of the queue.
   * @param {string} uri uri to hit
   * @returns {promise} promise of the result function
   */
  queueReadRequest = uri =>
    this._storeQueue.fetch(() => {
      return this._makeRequest('GET', uri)
    })

  // **************************** //
  // *          Read            * //
  // **************************** //

  getUserProfile = async userAddress => {
    const httpResponse = await this._makeRequest(
      'GET',
      `${this._storeUri}/${userAddress}`
    )

    return httpResponse.body
  }

  getDisputeData = async (arbitratorAddress, disputeId, userAddress) => {
    const userProfile = await this.getUserProfile(userAddress)
    if (!userProfile)
      throw new Error(`No profile found for address: ${userAddress}`)

    let disputeData = _.filter(
      userProfile.disputes,
      o =>
        o.arbitratorAddress === arbitratorAddress && o.disputeId === disputeId
    )

    const httpResponse = await this._makeRequest(
      'GET',
      `${this._storeUri}/arbitrators/${arbitratorAddress}/disputes/${disputeId}`
    )
    return Object.assign({}, httpResponse.body, disputeData[0])
  }

  getContractByHash = async (userAddress, hash) => {
    const userProfile = await this.getUserProfile(userAddress)
    if (!userProfile)
      throw new Error(`No profile found for address: ${userAddress}`)

    let contractData = _.filter(userProfile.contracts, o => o.hash === hash)

    if (contractData.length === 0) return null
    return contractData[0]
  }

  getContractByAddress = async (userAddress, addressContract) => {
    const userProfile = await this.getUserProfile(userAddress)
    if (!userProfile)
      throw new Error(`No profile found for this address: ${userAddress}`)

    let contract = _.filter(
      userProfile.contracts,
      contract => contract.address === addressContract
    )

    return contract[0]
  }

  getDisputesForUser = async address => {
    const userProfile = await this.getUserProfile(address)
    if (!userProfile) return []

    const disputes = []
    for (let i = 0; i < userProfile.disputes.length; i++) {
      const dispute = userProfile.disputes[i]
      if (!dispute.arbitratorAddress || _.isNil(dispute.disputeId)) continue
      // fetch dispute data
      const httpResponse = await this._makeRequest(
        'GET',
        `${this._storeUri}/arbitrators/${dispute.arbitratorAddress}/disputes/${
          dispute.disputeId
        }`
      )
      if (httpResponse.status === 200) {
        disputes.push(Object.assign({}, httpResponse.body, dispute))
      }
    }

    return disputes
  }

  getLastBlock = async account => {
    const userProfile = await this.getUserProfile(account)

    return userProfile.lastBlock ? userProfile.lastBlock : 0
  }

  getDispute = async (arbitratorAddress, disputeId) => {
    const httpResponse = await this._makeRequest(
      'GET',
      `${this._storeUri}/arbitrators/${arbitratorAddress}/disputes/${disputeId}`
    )

    return httpResponse.body
  }

  // **************************** //
  // *          Write           * //
  // **************************** //

  newUserProfile = async (address, userProfile) => {
    // NOTE we overwrite every time. No check
    const getBodyFn = () =>
      new Promise(resolve => {
        resolve(JSON.stringify(userProfile))
      })

    this.queueWriteRequest(getBodyFn, 'POST', `${this._storeUri}/${address}`)
  }

  /**
   * Set up a new user profile if one does not exist
   * @param {string} address user's address
   * @returns {object} users existing or created profile
   */
  setUpUserProfile = async address => {
    let userProfile = await this.getUserProfile(address)
    if (_.isNull(userProfile)) {
      this.newUserProfile(address, {})
      userProfile = await this.queueReadRequest(`${this._storeUri}/${address}`)
    }

    return userProfile
  }

  updateUserProfileSession = async (account, session) => {
    const getBodyFn = async () => {
      const currentProfile = await this.getUserProfile(account)
      currentProfile.session = session
      delete currentProfile._id
      delete currentProfile._createdAt
      return new Promise(resolve => resolve(JSON.stringify(currentProfile)))
    }

    this.queueWriteRequest(getBodyFn, 'POST', `${this._storeUri}/${account}`)
  }

  updateContract = async (
    address,
    hashContract,
    account,
    partyB,
    arbitratorAddress,
    timeout,
    email,
    title,
    description,
    disputeId
  ) => {
    const httpResponse = await this._makeRequest(
      'POST',
      `${this._storeUri}/${account}/contracts/${address}`,
      JSON.stringify({
        address,
        hashContract,
        partyA: account,
        partyB,
        arbitrator: arbitratorAddress,
        timeout,
        email,
        title,
        description,
        disputeId
      })
    )

    return httpResponse
  }

  addEvidenceContract = async (address, account, name, description, url) => {
    // get timestamp for submission
    const submittedAt = new Date().getTime()
    const httpResponse = await this._makeRequest(
      'POST',
      `${this._storeUri}/${account}/contracts/${address}/evidence`,
      JSON.stringify({
        name,
        description,
        url,
        submittedAt
      })
    )

    return httpResponse
  }

  updateDisputeProfile = async (
    account,
    appealDraws,
    arbitratorAddress,
    disputeId,
    netPNK
  ) => {
    const httpResponse = await this._makeRequest(
      'POST',
      `${
        this._storeUri
      }/${account}/arbitrators/${arbitratorAddress}/disputes/${disputeId}`,
      JSON.stringify({
        appealDraws,
        arbitratorAddress,
        disputeId,
        netPNK
      })
    )

    return httpResponse
  }

  // FIXME very complicated to update
  updateDispute = async (
    disputeId,
    arbitratorAddress,
    arbitrableContractAddress,
    partyA,
    partyB,
    title,
    status,
    information,
    justification,
    resolutionOptions,
    appealCreatedAt,
    appealRuledAt,
    appealDeadlines
  ) => {
    const httpResponse = await this._makeRequest(
      'POST',
      `${
        this._storeUri
      }/arbitrators/${arbitratorAddress}/disputes/${disputeId}`,
      JSON.stringify({
        disputeId,
        arbitratorAddress,
        arbitrableContractAddress,
        partyA,
        partyB,
        title,
        status,
        information,
        justification,
        resolutionOptions,
        appealCreatedAt,
        appealRuledAt,
        appealDeadlines
      })
    )
    return httpResponse
  }

  updateLastBlock = (account, lastBlock) => {
    const getBodyFn = async () => {
      const currentProfile = await this.getUserProfile(account)
      currentProfile.lastBlock = lastBlock
      delete currentProfile._id
      delete currentProfile._createdAt
      return new Promise(resolve => resolve(JSON.stringify(currentProfile)))
    }

    this.queueWriteRequest(getBodyFn, 'POST', `${this._storeUri}/${account}`)
  }

  newNotification = async (
    account,
    txHash,
    logIndex,
    notificationType,
    message = '',
    data = {},
    read = false
  ) => {
    const httpResponse = await this._makeRequest(
      'POST',
      `${this._storeUri}/${account}/notifications/${txHash}`,
      JSON.stringify({
        notificationType,
        logIndex,
        read,
        message,
        data
      })
    )
    return httpResponse
  }

  markNotificationAsRead = async (account, txHash, logIndex, isRead = true) => {
    const getBodyFn = async () => {
      const userProfile = await this.getUserProfile(account)

      const notificationIndex = await _.findIndex(
        userProfile.notifications,
        notification =>
          notification.txHash === txHash && notification.logIndex === logIndex
      )

      if (_.isNull(notificationIndex)) {
        throw new TypeError(`No notification with txHash ${txHash} exists`)
      }

      userProfile.notifications[notificationIndex].read = isRead
      return new Promise(resolve => resolve(JSON.stringify(userProfile)))
    }

    this.queueWriteRequest(getBodyFn, 'POST', `${this._storeUri}/${account}`)
  }
}

export default StoreProviderWrapper
