import type { Model } from '@shared/data/types/model'

export const dollars = (value: number) => `$${Number(value.toPrecision(4))}`

/** "$2 / $10": input and output price per million tokens; empty when the model has no price. */
export function formatModelPrice(model: Pick<Model, 'pricing'> | undefined): string {
  const input = model?.pricing?.input.perMillionTokens
  const output = model?.pricing?.output.perMillionTokens
  if (input == null || output == null) return ''
  return `${dollars(input)} / ${dollars(output)}`
}
