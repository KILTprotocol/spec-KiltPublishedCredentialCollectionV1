/* eslint-disable no-empty */

import type { ApiPromise } from '@polkadot/api'

import fetch from 'axios'

import * as Kilt from '@kiltprotocol/sdk-js'

// Peregrine testnet used for this example.
const endpointAddress = 'wss://peregrine.kilt.io/parachain-public-ws'
const web3Name = 'john_doe'
// The type to filter the endpoints of the retrieved DID.
const endpointType = 'KiltPublishedCredentialCollectionV1'

const verifyCredential = async (
  api: ApiPromise,
  publishedCredential: Kilt.ICredential
) => {
  // Retrieve the on-chain attestation information about the credential.
  const encodedOnChainAttestation = await api.query.attestation.attestations(
    publishedCredential.rootHash
  )

  const onChainAttestation = Kilt.Attestation.fromChain(
    encodedOnChainAttestation,
    publishedCredential.rootHash
  )
  if (onChainAttestation.revoked) {
    throw 'Credential revoked.'
  }

  return Kilt.Credential.verifyCredential(publishedCredential)
}

async function main() {
  const api = await Kilt.connect(endpointAddress)
  const encodedDidForWeb3Name = await api.query.web3Names.owner(web3Name)
  const { owner: didForWeb3Name } = Kilt.Did.Web3Names.web3NameOwnerFromChain(
    encodedDidForWeb3Name
  )
  console.log(`DID for "${web3Name}": ${didForWeb3Name}`)

  const resolutionResult = await Kilt.Did.resolve(didForWeb3Name)
  if (!resolutionResult) {
    throw 'The DID does not exist on the KILT blockchain.'
  }

  const { document } = resolutionResult
  // If no details are returned but resolutionResult is not null, the DID has been deleted.
  // This information is present in `resolutionResult.metadata.deactivated`.
  if (!document) {
    throw 'The DID has already been deleted.'
  }

  // Filter the endpoints by their type.
  const didEndpoints = document.service?.filter(({ type }) =>
    type.includes(endpointType)
  )

  console.log(`Endpoints of type "${endpointType}" for the retrieved DID:`)
  console.log(JSON.stringify(didEndpoints, null, 2))

  // For demonstration, only the first endpoint and its first URL are considered.
  const firstCredentialCollectionEndpointUrl =
    didEndpoints?.[0].serviceEndpoint[0]
  if (!firstCredentialCollectionEndpointUrl) {
    console.log(`The DID has no service endpoints of type "${endpointType}".`)
  }

  // Retrieve the credentials pointed at by the endpoint. Being an IPFS endpoint, the fetching can take an arbitrarily long time or even fail if the timeout is reached.
  // The case where the result is not a JSON should be properly handled in production settings.
  const credentialCollection = await fetch(
    firstCredentialCollectionEndpointUrl as string
  ).then(
    (response) =>
      response.data as Promise<Kilt.KiltPublishedCredentialCollectionV1>
  )
  console.log(`Credential collection behind the endpoint:`)
  console.log(JSON.stringify(credentialCollection, null, 2))

  // Verify that all credentials are valid and that they all refer to the same DID.
  await Promise.all(
    credentialCollection.map(async ({ credential }) => {
      await verifyCredential(api, credential)

      // Verify that the credential refers to the intended subject
      if (
        !Kilt.Did.Utils.isSameSubject(credential.claim.owner, didForWeb3Name)
      ) {
        throw 'One of the credentials refer to a different subject than expected.'
      }
    })
  )

  // If no promise is rejected, all the checks have successfully completed.
  console.log('All retrieved credentials are valid! ✅!')
}

;(async () => {
  try {
    await main()
  } catch {
    process.exit(1)
  } finally {
    await Kilt.disconnect()
  }
})()
