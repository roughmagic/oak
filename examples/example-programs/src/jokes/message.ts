import { Data } from 'effect'

export type JokeMsg = Data.TaggedEnum<{
  Fetch: {}
  Got: { readonly joke: string }
  Failed: { readonly error: string }
}>

export const JokeMsg = Data.taggedEnum<JokeMsg>()
