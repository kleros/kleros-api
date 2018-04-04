import Web3 from 'web3'

import KlerosPOC from '../../src/contracts/implementations/arbitrator/KlerosPOC'
import ArbitrableTransaction from '../../src/contracts/implementations/arbitrable/ArbitrableTransaction'
import Notifications from '../../src/resourceWrappers/Notifications'
import EventListeners from '../../src/resourceWrappers/EventListeners'
import * as ethConstants from '../../src/constants/eth'
import * as notificationConstants from '../../src/constants/notification'
import setUpContracts from '../helpers/setUpContracts'
import waitNotifications from '../helpers/waitNotifications'
import delaySecond from '../helpers/delaySecond'

describe('Notifications and Event Listeners', () => {
  let partyA
  let partyB
  let juror1
  let juror2
  let other
  let web3
  let notificationCallback
  let notifications = []
  let klerosPOCData
  let arbitrableContractData
  let provider

  beforeAll(async () => {
    // use testRPC
    provider = await new Web3.providers.HttpProvider(
      ethConstants.LOCALHOST_ETH_PROVIDER
    )

    web3 = await new Web3(provider)

    partyA = web3.eth.accounts[1]
    partyB = web3.eth.accounts[2]
    juror1 = web3.eth.accounts[3]
    juror2 = web3.eth.accounts[4]
    other = web3.eth.accounts[5]

    klerosPOCData = {
      timesPerPeriod: [1, 1, 1, 1, 1],
      account: other,
      value: 0
    }

    arbitrableContractData = {
      partyA,
      partyB,
      value: 1,
      hash: 'test',
      timeout: 1,
      extraData: '',
      title: 'test title',
      description: 'test description',
      email: 'test@test.test'
    }

    notificationCallback = notification => {
      notifications.push(notification)
    }
  })

  it(
    'notifications in dispute resolution',
    async () => {
      const [
        klerosPOCAddress,
        arbitrableContractAddress,
        rngAddress,
        pnkAddress
      ] = await setUpContracts(provider, klerosPOCData, arbitrableContractData)

      expect(klerosPOCAddress).toBeDefined()
      expect(arbitrableContractAddress).toBeDefined()
      expect(rngAddress).toBeDefined()
      expect(pnkAddress).toBeDefined()

      // EVENT LISTENER
      const KlerosPOCInstance = new KlerosPOC(provider, klerosPOCAddress)
      const ArbitrableTransactionInstance = new ArbitrableTransaction(
        provider,
        arbitrableContractAddress
      )
      const EventListenerInstance = new EventListeners(
        KlerosPOCInstance,
        ArbitrableTransactionInstance
      )
      const NotificationsInstance = new Notifications(
        KlerosPOCInstance,
        ArbitrableTransactionInstance,
        EventListenerInstance
      )

      // stateful notifications juror1
      let juror1StatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        juror1,
        true
      )
      expect(juror1StatefullNotifications.length).toEqual(1)
      expect(juror1StatefullNotifications[0].notificationType).toEqual(
        notificationConstants.TYPE.CAN_ACTIVATE
      )
      // buy 1 PNK juror1
      await KlerosPOCInstance.buyPNK(1, juror1)
      // buy PNK for juror2
      await KlerosPOCInstance.buyPNK(1, juror2)

      // activate PNK juror1
      const activatedTokenAmount = 0.5
      KlerosPOCInstance.activatePNK(activatedTokenAmount, juror1)
      // activate PNK juror2
      await KlerosPOCInstance.activatePNK(activatedTokenAmount, juror2)

      // stateful notifications juror1
      juror1StatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        juror1,
        true
      )
      expect(juror1StatefullNotifications.length).toEqual(0)
      // return a bigint
      // FIXME use arbitrableTransaction
      const arbitrableContractInstance = await ArbitrableTransactionInstance.loadContract()
      const partyAFeeContractInstance = await arbitrableContractInstance.partyAFee()

      // return bytes
      // FIXME use arbitrableTransaction
      let extraDataContractInstance = await arbitrableContractInstance.arbitratorExtraData()

      // return a bigint with the default value : 10000 wei fees in ether
      const arbitrationCost = await KlerosPOCInstance.getArbitrationCost(
        extraDataContractInstance
      )
      // raise dispute party A
      await ArbitrableTransactionInstance.payArbitrationFeeByPartyA(
        partyA,
        arbitrationCost -
          KlerosPOCInstance._Web3Wrapper.fromWei(
            partyAFeeContractInstance,
            'ether'
          )
      )

      const partyBFeeContractInstance = await arbitrableContractInstance.partyBFee()

      await ArbitrableTransactionInstance.payArbitrationFeeByPartyB(
        partyB,
        arbitrationCost -
          KlerosPOCInstance._Web3Wrapper.fromWei(
            partyBFeeContractInstance,
            'ether'
          )
      )

      // wait for dispute raised notification
      let {
        promise: waitPromisePartyA,
        callback: waitCallbackPartyA
      } = waitNotifications(1, notificationCallback)
      await NotificationsInstance.registerNotificationListeners(
        partyA,
        waitCallbackPartyA
      )
      await EventListenerInstance.watchForArbitratorEvents(partyA)

      await waitPromisePartyA
      expect(notifications.length).toEqual(1)
      expect(notifications[0].notificationType).toEqual(
        notificationConstants.TYPE.DISPUTE_CREATED
      )

      EventListenerInstance.stopWatchingArbitratorEvents()
      // pass state so jurors are selected
      for (let i = 1; i < 3; i++) {
        // NOTE we need to make another block before we can generate the random number. Should not be an issue on main nets where avg block time < period length
        if (i === 2)
          web3.eth.sendTransaction({
            from: partyA,
            to: partyB,
            value: 10000,
            data: '0x'
          })
        await delaySecond()
        await KlerosPOCInstance.passPeriod(other)
      }

      let drawA = []
      let drawB = []
      for (let i = 1; i <= 3; i++) {
        if (await KlerosPOCInstance.isJurorDrawnForDispute(0, i, juror1)) {
          drawA.push(i)
        } else {
          drawB.push(i)
        }
      }
      expect(drawA.length > 0 || drawB.length > 0).toBeTruthy()

      const jurorForNotifications =
        drawA.length > drawB.length ? juror1 : juror2
      // stateful notifications juror1
      let jurorStatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        jurorForNotifications,
        true
      )
      expect(jurorStatefullNotifications.length).toEqual(1)
      expect(jurorStatefullNotifications[0].notificationType).toEqual(
        notificationConstants.TYPE.CAN_VOTE
      )
      // submit rulings
      const rulingJuror1 = 1
      await KlerosPOCInstance.submitVotes(0, rulingJuror1, drawA, juror1)
      const rulingJuror2 = 2
      await KlerosPOCInstance.submitVotes(0, rulingJuror2, drawB, juror2)

      await delaySecond()
      await KlerosPOCInstance.passPeriod(other)

      await delaySecond()
      await KlerosPOCInstance.passPeriod(other)
      // stateful notifications
      jurorStatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        jurorForNotifications,
        true
      )
      expect(jurorStatefullNotifications.length).toEqual(1)
      expect(jurorStatefullNotifications[0].notificationType).toEqual(
        notificationConstants.TYPE.CAN_REPARTITION
      )

      // repartition tokens
      await KlerosPOCInstance.repartitionJurorTokens(0, other)

      // stateful notifications
      jurorStatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        jurorForNotifications,
        true
      )
      expect(jurorStatefullNotifications.length).toEqual(1)
      expect(jurorStatefullNotifications[0].notificationType).toEqual(
        notificationConstants.TYPE.CAN_EXECUTE
      )
      // execute ruling
      await KlerosPOCInstance.executeRuling(0, other)

      juror1StatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        juror1,
        true
      )
      expect(juror1StatefullNotifications.length).toEqual(0)
      let partyAStatefullNotifications = await NotificationsInstance.getStatefulNotifications(
        partyA,
        false
      )
      expect(partyAStatefullNotifications.length).toEqual(0)

      expect(notifications.length).toBeTruthy()

      let notificationTypesExpected = [
        notificationConstants.TYPE.DISPUTE_CREATED
      ]
      let notificationTypes = notifications.map(
        notification => notification.notificationType
      )
      expect(notificationTypes.sort()).toEqual(notificationTypesExpected.sort())

      EventListenerInstance.stopWatchingArbitratorEvents()

      // spin up juror1 notifications listener. should populate missed notifications
      const numberOfNotifications = drawA.length + 2

      notifications = []
      let {
        promise: waitPromiseJuror,
        callback: waitCallbackJuror
      } = waitNotifications(numberOfNotifications, notificationCallback)
      await NotificationsInstance.registerNotificationListeners(
        juror1,
        waitCallbackJuror
      )
      await EventListenerInstance.watchForArbitratorEvents(juror1)

      await waitPromiseJuror

      expect(notifications.length).toBeTruthy()

      notificationTypesExpected = [
        notificationConstants.TYPE.ARBITRATION_REWARD,
        notificationConstants.TYPE.APPEAL_POSSIBLE
      ]
      drawA.forEach(() =>
        notificationTypesExpected.push(notificationConstants.TYPE.TOKEN_SHIFT)
      )

      notificationTypes = notifications.map(
        notification => notification.notificationType
      )
      expect(notificationTypes.sort()).toEqual(notificationTypesExpected.sort())

      EventListenerInstance.stopWatchingArbitratorEvents()
      // TODO find way to check timestamps and other non-callback notifications
    },
    250000
  )
})
