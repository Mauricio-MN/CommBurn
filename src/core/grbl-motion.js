// GRBL's junction-deviation limit for two unit direction vectors, in mm/s.
export function junctionSpeedLimit(previousDirection, nextDirection, acceleration, deviation, maxSpeed) {
  const cosJunction = -(previousDirection.x * nextDirection.x + previousDirection.y * nextDirection.y);
  if (cosJunction > 0.999999) return 0;
  if (cosJunction < -0.999999) return maxSpeed;
  const halfSine = Math.sqrt(0.5 * (1 - cosJunction));
  return Math.min(maxSpeed, Math.sqrt(acceleration * deviation * halfSine / (1 - halfSine)));
}
