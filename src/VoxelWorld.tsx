import { useId } from 'react'

type CubeProps = {
  x: number
  y: number
  size?: number
  height?: number
  top?: string
  left?: string
  right?: string
}

const violet = { top: '#ac91ff', left: '#6d4aff', right: '#4931a8' }
const lime = { top: '#e5ff92', left: '#d5f45a', right: '#91b933' }
const turquoise = { top: '#a3f1df', left: '#56cdb5', right: '#329b91' }
const cream = { top: '#fffdf2', left: '#e8e2d3', right: '#c5bfbc' }

function Cube({ x, y, size = 27, height = size, top = '#c9b9eb', left = '#9182bb', right = '#6e6196' }: CubeProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <polygon points={`0,0 ${size},${size / 2} 0,${size} ${-size},${size / 2}`} fill={top} />
      <polygon points={`${-size},${size / 2} 0,${size} 0,${size + height} ${-size},${size / 2 + height}`} fill={left} />
      <polygon points={`0,${size} ${size},${size / 2} ${size},${size / 2 + height} 0,${size + height}`} fill={right} />
      <path d={`M${-size} ${size / 2} 0 ${size} ${size} ${size / 2} M0 ${size}v${height}`} fill="none" stroke="#252241" strokeOpacity=".1" strokeWidth=".8" />
    </g>
  )
}

function Building({ x, y, size = 34, height = 100, palette = violet, rows = 4 }: {
  x: number
  y: number
  size?: number
  height?: number
  palette?: { top: string; left: string; right: string }
  rows?: number
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Cube x={0} y={0} size={size} height={height} {...palette} />
      <Cube x={0} y={-6} size={size + 3} height={6} top={palette.top} left={palette.left} right={palette.right} />
      {Array.from({ length: rows }, (_, row) => (
        <g key={row}>
          {[0, 1, 2].map((column) => {
            const wx = -size + 7 + column * ((size - 12) / 3)
            const wy = size / 2 + 12 + (wx + size) / 2 + row * 19
            const rx = 7 + column * ((size - 12) / 3)
            const ry = size + 12 - rx / 2 + row * 19
            return (
              <g key={column}>
                <polygon points={`${wx},${wy} ${wx + 5},${wy + 2.5} ${wx + 5},${wy + 9.5} ${wx},${wy + 7}`} fill="#f4f2eb" fillOpacity=".75" />
                <polygon points={`${rx},${ry} ${rx + 5},${ry - 2.5} ${rx + 5},${ry + 4.5} ${rx},${ry + 7}`} fill="#d5f45a" fillOpacity=".85" />
              </g>
            )
          })}
        </g>
      ))}
      <polygon points={`8,${size + height - 27} 20,${size + height - 33} 20,${size + height - 10} 8,${size + height - 4}`} fill="#252241" fillOpacity=".6" />
    </g>
  )
}

function Tree({ x, y, size = 18 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="8" rx={size + 2} ry="7" fill="#252241" fillOpacity=".13" />
      <Cube x={0} y={-15} size={4} height={20} top="#9b8675" left="#836e5c" right="#5f5049" />
      <Cube x={0} y={-size - 27} size={size} height={size} {...lime} />
      <Cube x={-3} y={-size - 31} size={size * 0.65} height={5} {...lime} />
    </g>
  )
}

function GroundHalo({ x, y, size = 48 }: { x: number; y: number; size?: number }) {
  return <polygon className="voxel-link-halo" points={`${x},${y - size / 2} ${x + size},${y} ${x},${y + size / 2} ${x - size},${y}`} fill="none" stroke="#252241" strokeWidth="2.5" strokeDasharray="5 4" />
}

const terrain = Array.from({ length: 100 }, (_, index) => ({ u: index % 10, v: Math.floor(index / 10) }))
  .filter(({ u, v }) => !((u === 0 && (v < 2 || v > 7)) || (u === 9 && (v < 2 || v > 7)) || (v === 0 && (u < 2 || u > 7)) || (v === 9 && (u < 2 || u > 7))))
  .sort((a, b) => a.u + a.v - b.u - b.v)

function groundPoint(u: number, v: number) {
  return { x: 390 + (u - v) * 27, y: 241 + (u + v) * 13.5 }
}

/** Original decorative voxel landscape. The landmarks open real tools on the page. */
export default function VoxelWorld() {
  const id = useId().replaceAll(':', '')
  const shadowId = `${id}-voxel-shadow`

  return (
    <svg className="voxel-world" viewBox="0 0 780 620" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="VOXEN voxel island. Explore the market, agent seats, publications, and file integrity tools." style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
      <title>Explore the VOXEN IMD tools</title>
      <defs>
        <filter id={shadowId} x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="15" />
        </filter>
      </defs>
      <style>{`
        .voxel-world .voxel-ambient { transform-box: fill-box; transform-origin: center; animation: voxel-drift 7s ease-in-out infinite; }
        .voxel-world .voxel-ambient-alt { animation-delay: -3.5s; animation-duration: 9s; }
        .voxel-world .voxel-landmark { transition: filter 180ms ease; cursor: pointer; }
        .voxel-world .voxel-landmark-art { transition: transform 180ms ease; }
        .voxel-world .voxel-landmark:hover, .voxel-world .voxel-landmark:focus-visible { filter: brightness(1.08); outline: none; }
        .voxel-world .voxel-landmark:hover .voxel-landmark-art, .voxel-world .voxel-landmark:focus-visible .voxel-landmark-art { transform: translateY(-6px); }
        .voxel-world .voxel-link-halo { opacity: 0; transition: opacity 180ms ease; }
        .voxel-world .voxel-landmark:hover .voxel-link-halo, .voxel-world .voxel-landmark:focus-visible .voxel-link-halo { opacity: 1; }
        @keyframes voxel-drift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
        @media (prefers-reduced-motion: reduce) { .voxel-world .voxel-ambient { animation: none; } .voxel-world .voxel-landmark, .voxel-world .voxel-landmark-art, .voxel-world .voxel-link-halo { transition: none; } .voxel-world .voxel-landmark:hover .voxel-landmark-art, .voxel-world .voxel-landmark:focus-visible .voxel-landmark-art { transform: none; } }
      `}</style>

      <g aria-hidden="true">
        <ellipse cx="390" cy="562" rx="214" ry="29" fill="#6d4aff" fillOpacity=".17" filter={`url(#${shadowId})`} />
        <path d="M102 336C60 293 104 245 180 236M603 270c96 16 127 69 81 111M668 454c-29 46-79 78-138 94" fill="none" stroke="#9a86d0" strokeWidth="1.5" strokeDasharray="4 8" strokeLinecap="round" opacity=".55" />

        <g className="voxel-ambient">
          <Cube x={138} y={176} size={22} height={22} {...violet} />
          <Cube x={138} y={170} size={12} height={6} {...lime} />
        </g>
        <g className="voxel-ambient voxel-ambient-alt">
          <Cube x={645} y={174} size={28} height={28} {...lime} />
          <Cube x={662} y={223} size={12} height={12} {...violet} />
        </g>
        <g className="voxel-ambient">
          <Cube x={103} y={437} size={16} height={16} {...turquoise} />
        </g>
        <g className="voxel-ambient voxel-ambient-alt">
          <Cube x={651} y={465} size={17} height={17} {...violet} />
        </g>

        <g opacity=".45" className="voxel-ambient voxel-ambient-alt">
          <Cube x={459} y={83} size={23} height={13} top="#e1d6fc" left="#d4c4f5" right="#c4b1e7" />
          <Cube x={433} y={80} size={18} height={12} top="#ebe1ff" left="#d4c4f5" right="#c4b1e7" />
          <Cube x={484} y={98} size={15} height={10} top="#ebe1ff" left="#d4c4f5" right="#c4b1e7" />
        </g>

        {terrain.map(({ u, v }) => {
          const { x, y } = groundPoint(u, v)
          const road = u === 5 || v === 5
          const edge = u === 9 || v === 9 || (u === 8 && v === 8)
          return <Cube key={`${u}-${v}`} x={x} y={y} size={27} height={edge ? 49 : 44} top={road ? '#ece6f3' : (u + v) % 3 === 0 ? '#c9b9eb' : '#d7c9ef'} left={edge ? '#9a82cf' : '#9e8ac7'} right={edge ? '#6e55a3' : '#8067af'} />
        })}

        <path d="M390 323l108 54M282 377l108 54M363 391l54-27M417 418l54-27" fill="none" stroke="#bbaecc" strokeWidth="2" strokeDasharray="3 8" />

        <Tree x={390} y={271} size={17} />
        <Tree x={470} y={309} size={16} />
        <Tree x={283} y={319} size={19} />
        <Tree x={227} y={351} size={18} />
        <Tree x={553} y={365} size={18} />
        <Tree x={580} y={407} size={16} />

        <Cube x={444} y={353} size={21} height={24} {...cream} />
        <Cube x={444} y={345} size={24} height={8} {...turquoise} />
        <Cube x={444} y={336} size={11} height={9} {...turquoise} />
        <Cube x={309} y={382} size={18} height={22} {...cream} />
        <Cube x={309} y={370} size={21} height={12} {...violet} />

        <g>
          {[0, 1, 2, 3, 4, 5].map((step) => <Cube key={step} x={174 + step * 10} y={418 - step * 4.5} size={18} height={4 + step * 4} top="#fffaf0" left="#d5cfcb" right="#b9aacb" />)}
        </g>
        <Cube x={255} y={414} size={24} height={9} {...turquoise} />
        <Cube x={255} y={410} size={20} height={4} top="#adf2e0" left="#56cdb5" right="#329b91" />
        <path d="M239 424l14-7 18 9M244 430l14-7 13 6" fill="none" stroke="#f4f2eb" strokeOpacity=".7" strokeWidth="1.5" />
      </g>

      <a className="voxel-landmark" href="#seats" aria-label="Open the IMD agent seat explorer">
        <title>Explore IMD agent seats</title>
        <GroundHalo x={390} y={322} />
        <g className="voxel-landmark-art" aria-hidden="true">
          <Building x={390} y={151} size={35} height={131} rows={6} />
          <Cube x={390} y={130} size={23} height={20} {...violet} />
          <Cube x={390} y={114} size={12} height={16} {...lime} />
          <path d="M390 114v-22" stroke="#4931a8" strokeWidth="3" />
          <polygon points="391,92 414,103 391,108" fill="#d5f45a" />
          <Cube x={352} y={229} size={20} height={67} {...violet} />
          <polygon points="335,249 349,256 349,283 335,276" fill="#d5f45a" fillOpacity=".9" />
        </g>
      </a>

      <a className="voxel-landmark" href="#publications" aria-label="Open the IMD publication reader">
        <title>Read IMD publications</title>
        <GroundHalo x={498} y={392} size={57} />
        <g className="voxel-landmark-art" aria-hidden="true">
          <Building x={498} y={285} size={42} height={60} palette={turquoise} rows={2} />
          <Cube x={498} y={269} size={34} height={15} {...cream} />
          <Cube x={498} y={258} size={25} height={11} {...turquoise} />
          <polygon points="474,283 497,294 497,301 474,290" fill="#6d4aff" />
          <polygon points="502,294 524,283 524,290 502,301" fill="#6d4aff" />
          <path d="M485 273l13 6 13-6M498 279v10" fill="none" stroke="#252241" strokeWidth="2" strokeLinejoin="round" />
          <Cube x={537} y={330} size={13} height={20} {...cream} />
          <Cube x={537} y={324} size={16} height={6} {...lime} />
        </g>
      </a>

      <a className="voxel-landmark" href="#market" aria-label="Open the live IMD market tools">
        <title>Explore the IMD market</title>
        <GroundHalo x={309} y={388} size={54} />
        <g className="voxel-landmark-art" aria-hidden="true">
          <Building x={310} y={243} size={38} height={95} rows={4} />
          <Cube x={310} y={225} size={28} height={18} {...cream} />
          <Cube x={310} y={212} size={17} height={13} {...lime} />
          <Cube x={283} y={291} size={17} height={49} {...violet} />
          <path d="M316 266l8-13 8 4 8-18" stroke="#d5f45a" strokeWidth="3.5" fill="none" strokeLinejoin="round" />
          <Cube x={347} y={334} size={13} height={17} {...cream} />
          <Cube x={347} y={327} size={16} height={7} {...lime} />
        </g>
      </a>

      <g aria-hidden="true">
        <Tree x={201} y={389} size={17} />
        <Tree x={553} y={445} size={21} />
        <Tree x={255} y={450} size={17} />
        <Cube x={336} y={436} size={16} height={19} {...cream} />
        <Cube x={336} y={430} size={19} height={6} {...violet} />
        <Cube x={444} y={444} size={13} height={16} {...cream} />
        <Cube x={444} y={435} size={16} height={9} {...violet} />
      </g>

      <a className="voxel-landmark" href="#integrity" aria-label="Open the file integrity checker">
        <title>Check a file's integrity</title>
        <GroundHalo x={390} y={474} size={58} />
        <g className="voxel-landmark-art" aria-hidden="true">
          <Building x={390} y={360} size={39} height={65} palette={cream} rows={2} />
          <Cube x={390} y={345} size={42} height={15} {...lime} />
          <Cube x={390} y={327} size={27} height={18} {...lime} />
          <Cube x={390} y={312} size={14} height={15} {...lime} />
          <polygon points="358,390 376,399 376,418 367,422 358,409" fill="#6d4aff" />
          <path d="M362 405l4 7 7-6" fill="none" stroke="#f4f2eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <Cube x={424} y={411} size={11} height={31} {...lime} />
          <Cube x={353} y={430} size={12} height={16} {...violet} />
        </g>
      </a>

      <g aria-hidden="true">
        <Tree x={309} y={475} size={18} />
        <Tree x={471} y={474} size={17} />
        <Cube x={390} y={497} size={27} height={9} top="#f4f2eb" left="#d2c9df" right="#b9a4d1" />
        <g transform="translate(373 518) skewY(26.565)">
          <text fill="#f4f2eb" fontFamily="sans-serif" fontSize="12" fontWeight="800" letterSpacing="2">VOXEN</text>
        </g>
        <path d="M571 272v20m-10-10h20M202 209v14m-7-7h14M694 410v14m-7-7h14" stroke="#6d4aff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="170" cy="486" r="3" fill="#6d4aff" />
        <circle cx="595" cy="128" r="3" fill="#6d4aff" />
        <circle cx="699" cy="305" r="3" fill="#d5f45a" />
      </g>
    </svg>
  )
}
