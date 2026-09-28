import * as Optic from '@fp-ts/optic'
import { identity } from 'effect'

/**
 * The root optic of a `Data.case` model. Optic's `at` copies the model into a plain object,
 * which drops structural equality. This iso passes every copy back through the constructor, so
 * an updated model is still a `Data.case` value and `Equal.equals` compares it by value.
 */
export const caseIso = <A>(make: (fields: A) => A): Optic.Iso<A, A> => Optic.iso(identity, make)
