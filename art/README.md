# The Loft cast

A pigeon courier carries every payment, and each person picks a creature:
pangolin, tortoise or hornbill. Generated with Higgsfield (`nano_banana_pro`,
2k, 3:2), backgrounds removed with Higgsfield's background remover, then cut
into one WebP per pose by `scripts/slice-cast.ts` into `web/public/cast/`.

The full-size sheets are kept out of git (large); `sheets/preview/` has small
copies for reference.

## Shared style

Character pose sheet, one original mascot in six poses, two rows by three
columns with generous empty space, full body in every cell, small pose numbers
underneath. Stylized 3D character render, chunky rounded proportions, soft matte
vinyl-toy material with a subtle clay texture, soft global illumination,
three-point lighting with a warm rim light, flat light warm-grey background.
The envelope in every sheet is cream with a terracotta wax seal.

## Characters and poses

| Sheet | Character | Poses (1 → 6) |
|---|---|---|
| pigeon | plump grey-blue homing pigeon, iridescent green-purple neck, terracotta satchel with a cream house emblem, terracotta courier cap | fly-up, fly-down, perch (on a tiled roof, envelope under wing), handoff, salute, sleep (on a perch by a calendar) |
| pangolin | small round baby pangolin, bronze scales, cream belly, terracotta knitted scarf | idle, wave, catch, cheer, wait (sitting, chin on hands), worried |
| tortoise | small round tortoise walking upright, amber shell with an indigo resist-dye pattern, olive skin, round gold spectacles | idle, wave, catch, cheer, wait (tucked in its shell), worried |
| hornbill | small round hornbill, glossy black and cream feathers, golden-orange bill and casque, green and terracotta bead necklace | idle, wave, catch, cheer, wait (sitting), worried |

## What drives each pose (nothing is decorative)

- The courier flies from the sender to the recipient while the payment is in
  flight, circles until the relay reports the transaction confirmed, then lands.
  The flight lasts as long as the real confirmation.
- A link's courier lands on the recipient's roof and waits there (perch) until
  they open it; then it hands over (handoff) and their creature catches it.
- Your creature on Home cheers for a few seconds when your balance actually goes
  up, and looks worried only when someone keeps you topped up and your balance
  has fallen under a quarter of that target.
