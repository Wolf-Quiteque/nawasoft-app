// Turns errors from the nawasoft_* trip functions into messages staff can act on.
const TRANSLATIONS = [
  [/Choose at least one route/i, 'Escolha pelo menos um destino.'],
  [/needs a departure, a later arrival and a price/i, 'Cada percurso precisa de partida, chegada depois da partida e preço.'],
  [/same route was supplied twice/i, 'O mesmo percurso foi escolhido duas vezes.'],
  [/Route not found or not available/i, 'Percurso inexistente ou inativo para esta empresa.'],
  [/already serves that route/i, 'Este autocarro já faz esse percurso.'],
  [/Routes must overlap/i, 'Os horários têm de se sobrepor aos da viagem para partilhar o mesmo autocarro e lugares.'],
  [/Bus or driver is already assigned/i, 'O autocarro ou o motorista já têm outra viagem nesse horário.'],
  [/seat holds/i, 'Há lugares reservados online neste momento. Aguarde alguns minutos e tente de novo.'],
  [/Passengers have already boarded/i, 'Já há passageiros embarcados nesta viagem.'],
  [/do not fit|does not have enough passenger seats/i, 'Os passageiros não cabem no autocarro escolhido.'],
  [/Choose a journey on another bus/i, 'Escolha uma viagem noutro autocarro.'],
  [/must be active and belong to the same company/i, 'As duas viagens têm de estar ativas e ser da mesma empresa.'],
  [/Only active journeys/i, 'Só é possível alterar viagens ativas.'],
  [/not found/i, 'Viagem não encontrada.'],
];

export function translateTripError(error) {
  const message = String(error?.message || 'Não foi possível alterar a viagem.');
  return TRANSLATIONS.find(([pattern]) => pattern.test(message))?.[1] || message;
}

export function tripErrorStatus(error) {
  if (error?.code === 'P0002') return 404;
  return ['22023', '23P01', '55P03', '23503'].includes(error?.code) ? 409 : 500;
}
