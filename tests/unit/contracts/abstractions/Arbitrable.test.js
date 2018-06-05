import ArbitrableContractApi from '../../../../src/contracts/abstractions/Arbitrable'
import ArbitrableTransaction from '../../../../src/contracts/implementations/arbitrable/ArbitrableTransaction'
import _asyncMockResponse from '../../../helpers/asyncMockResponse'

describe('ArbitrableContract', async () => {
  let arbitrableContractInstance

  beforeEach(async () => {
    const _arbitrableTransaction = new ArbitrableTransaction({})
    arbitrableContractInstance = new ArbitrableContractApi(
      _arbitrableTransaction,
      {}
    )
  })

  describe('getEvidenceForArbitrableContract', async () => {
    it('combines evidence from both parties', async () => {
      const partyA = '0x0'
      const partyB = '0x1'
      const mockData = {
        partyA,
        partyB
      }
      const mockGetData = jest.fn()
      arbitrableContractInstance._contractImplementation.getData = mockGetData.mockReturnValue(
        _asyncMockResponse(mockData)
      )

      const mockGetContractByAddress = jest.fn()
      // return partyA then partyB contract
      mockGetContractByAddress.mockReturnValueOnce({
        evidence: [
          {
            name: 'testPartyA'
          }
        ]
      })
      mockGetContractByAddress.mockReturnValueOnce({
        evidence: [
          {
            name: 'testPartyB'
          }
        ]
      })

      const mockStore = {
        getContractByAddress: mockGetContractByAddress
      }

      arbitrableContractInstance.setStoreProviderInstance(mockStore)

      const evidence = await arbitrableContractInstance.getEvidenceForArbitrableContract()

      expect(evidence).toBeTruthy()
      expect(evidence.length).toBe(2)
      expect(evidence[0].submitter).toEqual(partyA)
    })
    it('still fetches evidence when one party has none', async () => {
      const partyA = '0x0'
      const partyB = '0x1'
      const mockData = {
        partyA,
        partyB
      }
      const mockGetData = jest.fn()
      arbitrableContractInstance._contractImplementation.getData = mockGetData.mockReturnValue(
        _asyncMockResponse(mockData)
      )

      const mockGetContractByAddress = jest.fn()
      // return partyA then partyB contract
      mockGetContractByAddress.mockReturnValueOnce({
        evidence: [
          {
            name: 'testPartyA'
          }
        ]
      })
      mockGetContractByAddress.mockReturnValueOnce(null)

      const mockStore = {
        getContractByAddress: mockGetContractByAddress
      }

      arbitrableContractInstance.setStoreProviderInstance(mockStore)

      const evidence = await arbitrableContractInstance.getEvidenceForArbitrableContract()

      expect(evidence).toBeTruthy()
      expect(evidence.length).toBe(1)
      expect(evidence[0].submitter).toEqual(partyA)
    })
  })
})
