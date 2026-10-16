/* scene.js — vector SVG scene: girl-agent + shepherd dog + office room */
(function () {
'use strict';

const C = {teal:'#02BDB6',tealD:'#029E98',blue:'#263CD9',skin:'#F2C9A8',skinD:'#E2B08A',hair:'#3A2924',navy:'#2B3A5C',navyD:'#21304D'};
const D = {T:'#C98A4C',TD:'#A86B34',K:'#2C2A2E',CR:'#EFD9B5'};

function head() {
  return `<g class="head">
  <path d="M6 -8 q13 1 12 16 q-1 9 -7 13 q3 -11 -6 -19z" fill="${C.hair}"/>
  <circle r="11" fill="${C.skin}"/>
  <path d="M-11.5 0 q-1 -14 12 -14 q12 0 12 14 q-3 -2 -6 -2 q-1 -6 -8 -7 q-6 0 -10 9z" fill="${C.hair}"/>
  <rect x="5" y="-11" width="5" height="3" rx="1.5" fill="${C.teal}" transform="rotate(20 7 -9)"/>
  <g class="eyes"><ellipse cx="-6" cy="1.5" rx="1.4" ry="1.9" fill="#2A1E1A"/><ellipse cx="0.5" cy="1.5" rx="1.4" ry="1.9" fill="#2A1E1A"/></g>
  <path class="eyes-closed" d="M-7.6 1.8 q1.6 1.3 3.2 0 M-1.1 1.8 q1.6 1.3 3.2 0" stroke="#2A1E1A" stroke-width="1" fill="none" stroke-linecap="round"/>
  <circle cx="-8.4" cy="5.4" r="2" fill="#F4A0A0" opacity=".55"/><circle cx="2.7" cy="5.4" r="2" fill="#F4A0A0" opacity=".55"/>
  <path class="m m-smile" d="M-4.6 6.3 q1.6 1.6 3.2 0" stroke="#B4615A" stroke-width="1.1" fill="none" stroke-linecap="round"/>
  <path class="m m-open" d="M-4.8 5.8 q1.8 4 3.6 0z" fill="#B4615A"/>
  <ellipse class="m m-o" cx="-3" cy="6.9" rx="1.5" ry="2" fill="#B4615A"/>
  <path class="m m-flat" d="M-4.4 6.8 h2.8" stroke="#B4615A" stroke-width="1.1" stroke-linecap="round"/>
</g>`;
}

function arm(cls, shade) {
  const sl = shade ? C.tealD : C.teal, sk = shade ? C.skinD : C.skin;
  return `<g class="arm ${cls}"><rect x="-3.6" y="-2" width="7.2" height="12" rx="3.6" fill="${sl}"/><rect x="-2.6" y="7" width="5.2" height="19" rx="2.6" fill="${sk}"/><circle cy="26.5" r="3" fill="${sk}"/></g>`;
}

function leg(cls, fill) {
  return `<g class="leg ${cls}"><rect x="-3.3" y="0" width="6.6" height="37" rx="3.3" fill="${fill}"/><ellipse cx="-1.6" cy="37.6" rx="5" ry="2.6" fill="${C.blue}"/></g>`;
}

function dhead() {
  return `<g class="dhead">
  <path d="M-8 -4 l-4 -16 l10 8z" fill="${D.K}"/>
  <path d="M0 -7 l3 -16 l7 13z" fill="${D.K}"/>
  <path d="M1.8 -9 l1.8 -9 l3.6 7.5z" fill="#6B4A3A"/>
  <ellipse rx="10.5" ry="9" fill="${D.T}"/>
  <path d="M-9 -3 q2 -8 10 -8 q7 0 9 5 q-6 -2 -9 1 q-4 3 -10 2z" fill="${D.K}" opacity=".9"/>
  <ellipse cx="11" cy="3" rx="9.5" ry="5.5" fill="${D.T}"/>
  <path d="M3 0.5 q9 -5 17 0.5 q-8 2.5 -17 -0.5z" fill="${D.K}"/>
  <ellipse cx="5" cy="5" rx="6" ry="3.4" fill="${D.CR}"/>
  <ellipse cx="20" cy="1.6" rx="2.7" ry="2.1" fill="#161616"/>
  <g class="deyes"><ellipse cx="2.5" cy="-1.5" rx="1.7" ry="2" fill="#161616"/><circle cx="3.1" cy="-2.2" r=".6" fill="#fff"/></g>
  <path class="deyes-c" d="M0.8 -1.2 q1.7 1.3 3.4 0" stroke="#161616" stroke-width="1" fill="none" stroke-linecap="round"/>
  <path d="M13 6.4 q3 1.2 6 -0.8" stroke="#5A3A20" stroke-width=".9" fill="none" stroke-linecap="round"/>
  <path class="tongue" d="M14.5 6.5 q1 7 4.5 6 q2 -1 0.5 -6z" fill="#EE7B8B"/>
</g>`;
}

// kanban board on monitor
let kanban = '';
const cols = [210,229,248,267], heads = [C.teal,C.blue,'#F2B33D','#3BB273'], counts = [3,2,2,1];
cols.forEach((x,i) => {
  kanban += `<rect x="${x}" y="111" width="16" height="3" rx="1.5" fill="${heads[i]}"/>`;
  for (let j = 0; j < counts[i]; j++) kanban += `<rect x="${x}" y="${116+j*7}" width="16" height="5" rx="1.5" fill="#fff" stroke="#D5E3E7" stroke-width=".6"/>`;
});
kanban += `<rect id="mcard" x="229" y="130" width="16" height="5" rx="1.5" fill="#E6ECFF" stroke="${C.blue}" stroke-width=".7"/>`;
kanban += `<rect class="cursor" x="268" y="124" width="7" height="1.6" rx=".8" fill="${C.teal}"/>`;

const SVG_SRC = `<svg id="room" class="tod-day" viewBox="0 0 480 270" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:100%" role="img" aria-label="Кабинет агента: девушка за компьютером и овчарка" data-mouth="smile" data-eyes="open">
<defs>
  <linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5FAFB"/><stop offset="1" stop-color="#E3EFF1"/></linearGradient>
  <linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ECDEC9"/><stop offset="1" stop-color="#E0CDB2"/></linearGradient>
  <linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky1)"/><stop offset="1" style="stop-color:var(--sky2)"/></linearGradient>
</defs>
<rect width="480" height="222" fill="url(#gWall)"/>
<rect y="214" width="480" height="8" fill="#D8E6E9"/>
<rect y="222" width="480" height="48" fill="url(#gFloor)"/>
<g stroke="#D3C0A3" stroke-width="1" opacity=".7" fill="none">
  <path d="M0 238 H480 M0 255 H480"/>
  <path d="M60 222 V238 M190 222 V238 M330 222 V238 M120 238 V255 M270 238 V255 M410 238 V255 M40 255 V270 M220 255 V270 M380 255 V270"/>
</g>
<path d="M22 16 H44 C40 50 42 92 48 128 H22Z" fill="${C.teal}" opacity=".16"/>
<rect x="30" y="22" width="104" height="100" rx="8" fill="#FFFFFF"/>
<rect x="36" y="28" width="92" height="88" rx="4" fill="url(#gSky)"/>
<g class="stars" fill="#fff"><circle cx="48" cy="38" r=".9"/><circle cx="70" cy="34" r="1.1"/><circle cx="92" cy="50" r=".8"/><circle cx="58" cy="58" r=".9"/><circle cx="120" cy="62" r="1"/><circle cx="100" cy="36" r=".8"/></g>
<circle class="sun" r="8" style="fill:var(--sun)"/>
<g class="moon"><circle cx="110" cy="44" r="8" fill="#F5F0D6"/><circle cx="114" cy="41" r="7" style="fill:var(--sky1)"/></g>
<g class="clouds" fill="#fff" opacity=".85"><g class="cloud"><ellipse cx="54" cy="50" rx="12" ry="4.5"/><ellipse cx="60" cy="46.5" rx="7" ry="4.5"/></g></g>
<g style="fill:var(--city)">
  <rect x="38" y="96" width="12" height="20"/><rect x="70" y="92" width="9" height="24"/><rect x="100" y="94" width="11" height="22"/><rect x="113" y="101" width="15" height="15"/>
  <path d="M59 116 L61.5 91 L64.5 91 L67 116Z"/>
  <path d="M61.5 91 Q57 86 58.5 81 L60 82 Q59.5 86 62.5 89Z M64.5 91 Q69 86 67.5 81 L66 82 Q66.5 86 63.5 89Z"/>
  <rect x="62.4" y="73" width="1.2" height="5"/>
</g>
<circle cx="63" cy="83" r="5" fill="#F2C14E"/>
<g class="lights" fill="#FFD66B"><rect x="41" y="100" width="2" height="2"/><rect x="45" y="106" width="2" height="2"/><rect x="73" y="98" width="2" height="2"/><rect x="103" y="99" width="2" height="2"/><rect x="107" y="107" width="2" height="2"/><rect x="117" y="105" width="2" height="2"/></g>
<rect x="81" y="28" width="2.4" height="88" fill="#fff"/>
<rect x="36" y="70" width="92" height="2.4" fill="#fff"/>
<rect x="26" y="120" width="112" height="6" rx="3" fill="#FFFFFF"/>
<path d="M142 16 H120 C124 50 122 92 116 128 H142Z" fill="${C.teal}" opacity=".16"/>
<rect x="182" y="30" width="48" height="58" rx="4" fill="#FFFFFF" stroke="#D9E4E8"/>
<rect x="187" y="35" width="38" height="48" rx="2" fill="#E9F8F7"/>
<circle cx="206" cy="54" r="11" fill="${C.teal}"/>
<text x="206" y="57.6" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff" font-family="Segoe UI,sans-serif">SW</text>
<rect x="194" y="70" width="24" height="2.4" rx="1.2" fill="${C.blue}" opacity=".6"/>
<rect x="198" y="75" width="16" height="2" rx="1" fill="#9FB0BA"/>
<circle cx="300" cy="48" r="13" fill="#fff" stroke="#D3DEE3" stroke-width="1.5"/>
<path d="M300 37.5 V40 M300 56 V58.5 M289.5 48 H292 M308 48 H310.5" stroke="#9AA8B2" stroke-width="1.2"/>
<line id="hh" x1="300" y1="48" x2="300" y2="41" stroke="${C.blue}" stroke-width="2" stroke-linecap="round"/>
<line id="mm" x1="300" y1="48" x2="300" y2="38.5" stroke="#13222A" stroke-width="1.4" stroke-linecap="round"/>
<circle cx="300" cy="48" r="1.5" fill="${C.teal}"/>
<rect x="390" y="46" width="4" height="14" rx="2" fill="#AEB9C4"/>
<rect x="452" y="46" width="4" height="14" rx="2" fill="#AEB9C4"/>
<path d="M386 58 H460" stroke="#8E9AA7" stroke-width="3.2" stroke-linecap="round"/>
<ellipse cx="86" cy="242" rx="58" ry="6" fill="#000" opacity=".05"/>
<ellipse cx="86" cy="240" rx="56" ry="11" fill="#C9D6FB"/>
<ellipse cx="86" cy="237" rx="46" ry="7" fill="#DCE5FF"/>
<ellipse cx="420" cy="223" rx="58" ry="4" fill="#000" opacity=".06"/>
<rect x="376" y="208" width="4" height="14" rx="1" fill="#5A4A3E"/>
<rect x="464" y="208" width="4" height="14" rx="1" fill="#5A4A3E"/>
<rect x="378" y="166" width="90" height="32" rx="11" fill="#8292EC"/>
<rect x="372" y="190" width="100" height="20" rx="8" fill="#6F81E4"/>
<rect x="364" y="176" width="17" height="36" rx="8.5" fill="#5F71DC"/>
<rect x="463" y="176" width="17" height="36" rx="8.5" fill="#5F71DC"/>
<rect x="430" y="174" width="26" height="18" rx="6" fill="${C.teal}" opacity=".85"/>
<ellipse cx="248" cy="223" rx="96" ry="4" fill="#000" opacity=".06"/>
<rect x="164" y="172" width="6" height="50" rx="2" fill="#C29A72"/>
<rect x="326" y="172" width="6" height="50" rx="2" fill="#C29A72"/>
<rect x="172" y="174" width="38" height="30" rx="3" fill="#E4C4A0"/>
<rect x="186" y="186" width="10" height="2.4" rx="1.2" fill="#B98F66"/>
<rect x="156" y="165" width="184" height="8" rx="3" fill="#D8B28A"/>
<rect x="156" y="171" width="184" height="2.5" fill="#C29A72"/>
<rect x="162" y="132" width="26" height="34" rx="5" fill="#2E3A52"/>
<rect x="160" y="128" width="30" height="7" rx="3" fill="#3B4866"/>
<rect x="167" y="139" width="16" height="6" rx="2" fill="#15202F"/>
<circle cx="171" cy="142" r="1.3" fill="${C.teal}"/><circle cx="176" cy="142" r="1.3" fill="#FFD66B"/>
<rect x="171" y="147" width="8" height="4" rx="1" fill="#9AA7B5"/>
<rect x="170.5" y="157" width="9" height="8" rx="2" fill="#FFFFFF"/>
<rect x="196" y="157" width="8" height="9" rx="2" fill="${C.blue}"/>
<path d="M204 159.5 q3 0 3 2.5 q0 2.5 -3 2.5" fill="none" stroke="${C.blue}" stroke-width="1.2"/>
<rect x="241" y="156" width="8" height="10" fill="#9AA7B5"/>
<rect x="230" y="163" width="30" height="3" rx="1.5" fill="#9AA7B5"/>
<rect x="203" y="104" width="86" height="54" rx="6" fill="#26324A"/>
<rect x="207" y="108" width="78" height="44" rx="3" fill="#F3FAFB"/>
${kanban}
<rect id="scr-gray" x="207" y="108" width="78" height="44" rx="3" fill="#B7C1C7"/>
<rect id="scr-red" x="207" y="108" width="78" height="44" rx="3" fill="#FF4D57"/>
<rect id="scr-flash" x="207" y="108" width="78" height="44" rx="3" fill="#FFFFFF"/>
<rect id="scr-off" x="207" y="108" width="78" height="44" rx="3" fill="#0E1626"/>
<g id="sticky"><g transform="translate(283 101) rotate(10)"><rect width="13" height="13" rx="1.5" fill="#FFE07A"/><path d="M3 5 h7 M3 8 h5" stroke="#C9A43A" stroke-width="1"/></g></g>
<rect x="258" y="161" width="32" height="5" rx="2" fill="#CBD5DF"/>
<path d="M261 163.5 h26" stroke="#AEB9C4" stroke-width="1" stroke-dasharray="2 1.4"/>
<g class="plant">
  <ellipse cx="353" cy="176" rx="5" ry="21" fill="#3FA37F"/>
  <ellipse cx="344" cy="183" rx="4.5" ry="16" fill="#4DB38D" transform="rotate(-26 344 183)"/>
  <ellipse cx="362" cy="183" rx="4.5" ry="16" fill="#379171" transform="rotate(26 362 183)"/>
  <ellipse cx="348" cy="190" rx="3.5" ry="10" fill="#5BC39A" transform="rotate(-50 348 190)"/>
</g>
<path d="M341 198 H365 L361 222 H345Z" fill="#F3F6F8" stroke="#D5DEE3"/>
<ellipse cx="309" cy="222" rx="20" ry="2.5" fill="#000" opacity=".07"/>
<rect x="318" y="150" width="9" height="44" rx="4.5" fill="#2E3A52"/>
<rect x="290" y="189" width="38" height="7" rx="3.5" fill="#3A4763"/>
<rect x="306" y="196" width="5" height="16" fill="#8794A6"/>
<path d="M292 214 H326" stroke="#8794A6" stroke-width="3" stroke-linecap="round"/>
<circle cx="294" cy="218" r="2.6" fill="#2E3A52"/><circle cx="324" cy="218" r="2.6" fill="#2E3A52"/>
<rect id="shade" width="480" height="270" fill="#0A1534"/>
<rect id="warm" width="480" height="270" fill="#FF8A3D"/>
<g id="dog" transform="translate(86 235) scale(1.08)">
  <g class="d-lie">
    <g transform="translate(-27 -9)"><path class="dtail" d="M0 0 q-12 -3 -19 4 q-3 4 2 4 q8 -4 17 -2z" fill="${D.TD}"/></g>
    <ellipse cx="-5" cy="-10" rx="25" ry="10" fill="${D.T}"/>
    <path d="M-26 -12 q14 -11 34 -5 q-4 6 -18 7 q-11 0 -16 -2z" fill="${D.K}"/>
    <ellipse cx="-19" cy="-5" rx="9" ry="6" fill="${D.TD}"/>
    <ellipse cx="-1" cy="-2.5" rx="15" ry="3" fill="${D.CR}" opacity=".8"/>
    <ellipse cx="15" cy="-13" rx="9" ry="11" fill="${D.T}"/>
    <ellipse cx="19" cy="-11" rx="5" ry="7" fill="${D.CR}"/>
    <rect x="13" y="-5" width="21" height="5" rx="2.5" fill="${D.TD}"/>
    <rect x="16" y="-3.5" width="21" height="5" rx="2.5" fill="${D.T}"/>
    <g transform="translate(20 -26)"><g class="dheadanim">${dhead()}</g></g>
  </g>
  <g class="d-curl hide">
    <path class="dbreath" d="M-30 0 Q-34 -22 -4 -22 Q26 -22 28 -4 Q29 0 24 0 Z" fill="${D.T}"/>
    <path d="M-24 -14 Q-6 -27 16 -16 Q2 -10 -10 -10 Q-20 -10 -24 -14Z" fill="${D.K}"/>
    <path d="M-30 -2 Q-6 10 26 0 Q20 6 8 6 H-22 Q-32 6 -30 -2Z" fill="${D.TD}"/>
    <g transform="translate(15 -9) scale(.85)"><g>${dhead()}</g></g>
  </g>
  <g class="d-sit hide">
    <path d="M-12 -2 Q-26 0 -32 -6 Q-28 2 -12 3Z" fill="${D.TD}"/>
    <ellipse cx="-6" cy="-12" rx="13" ry="12" fill="${D.T}"/>
    <ellipse cx="7" cy="-26" rx="10" ry="17" fill="${D.T}" transform="rotate(-14 7 -26)"/>
    <path d="M-15 -18 Q-8 -36 6 -38 Q2 -26 -8 -18Z" fill="${D.K}"/>
    <ellipse cx="12" cy="-24" rx="5.5" ry="10" fill="${D.CR}" transform="rotate(-14 12 -24)"/>
    <g class="hindpaw"><ellipse cx="2" cy="-1.5" rx="8" ry="2.8" fill="${D.TD}"/></g>
    <rect x="7" y="-16" width="5" height="16" rx="2.5" fill="${D.TD}"/>
    <g class="frontleg"><rect x="12" y="-16" width="5" height="16" rx="2.5" fill="${D.T}"/></g>
    <g class="scratchleg"><g transform="translate(-6 -12)"><g class="scratchanim"><path d="M0 0 L13 -26" stroke="${D.TD}" stroke-width="6" stroke-linecap="round"/><ellipse cx="14" cy="-28" rx="3.6" ry="2.6" fill="${D.TD}"/></g></g></g>
    <g transform="translate(12 -46)"><g class="dheadanim">${dhead()}</g></g>
    <g class="washpaw"><g transform="translate(14 -20)"><g class="washanim"><path d="M0 0 L8 -18" stroke="${D.T}" stroke-width="5" stroke-linecap="round"/><ellipse cx="9" cy="-20" rx="3.2" ry="2.6" fill="${D.T}"/></g></g></g>
  </g>
  <g class="d-stand hide">
    <g transform="translate(-24 -32)"><g class="dtailw"><path d="M0 0 Q-10 4 -14 18 Q-12 22 -9 18 Q-6 8 2 4Z" fill="${D.TD}"/></g></g>
    <rect x="-22" y="-22" width="5.5" height="22" rx="2.7" fill="${D.TD}"/>
    <rect x="9" y="-22" width="5.5" height="22" rx="2.7" fill="${D.TD}"/>
    <ellipse cx="-3" cy="-28" rx="25" ry="10" fill="${D.T}"/>
    <path d="M-26 -30 Q-8 -42 14 -34 Q4 -27 -10 -27 Q-20 -27 -26 -30Z" fill="${D.K}"/>
    <ellipse cx="-3" cy="-21" rx="15" ry="3" fill="${D.CR}" opacity=".8"/>
    <rect x="-15" y="-22" width="5.5" height="22" rx="2.7" fill="${D.T}"/>
    <rect x="15" y="-22" width="5.5" height="22" rx="2.7" fill="${D.T}"/>
    <ellipse cx="17" cy="-31" rx="8" ry="10" fill="${D.T}"/>
    <ellipse cx="20" cy="-29" rx="4.5" ry="7" fill="${D.CR}"/>
    <g transform="translate(24 -46)"><g class="dheadanim">${dhead()}</g></g>
  </g>
  <g class="dzzz zz" fill="#5B6B9A" font-family="Segoe UI,sans-serif" font-weight="700"><text x="22" y="-26" font-size="8">z</text><text x="28" y="-34" font-size="10">z</text><text x="35" y="-43" font-size="12">Z</text></g>
</g>
<g id="lie" class="hide">
  <g transform="translate(390 181) rotate(-12)">${head()}</g>
  <path class="blanket" d="M397 176 Q430 166 466 174 Q474 182 468 194 H398 Q392 186 397 176Z" fill="#BDEDEA"/>
  <path d="M412 171 L415 194 M428 168 L431 194 M444 168 L447 194" stroke="${C.teal}" stroke-width="2" opacity=".35"/>
  <g class="zz" fill="#5B6B9A" font-family="Segoe UI,sans-serif" font-weight="700"><text x="402" y="160" font-size="9">z</text><text x="410" y="150" font-size="12">z</text><text x="419" y="139" font-size="15">Z</text></g>
</g>
<g id="sit" transform="translate(306 188)"><g class="sbody">
  <g transform="translate(-2 -25)">${arm('arm-b',true)}</g>
  <rect x="-26" y="-6" width="30" height="9" rx="4.5" fill="${C.navy}"/>
  <rect x="-27" y="-2" width="7.5" height="30" rx="3.7" fill="${C.navy}"/>
  <ellipse cx="-25" cy="29" rx="6.5" ry="3" fill="${C.blue}"/>
  <rect x="-10" y="-31" width="20" height="33" rx="7" fill="${C.teal}"/>
  <circle cx="-3" cy="-20" r="2.2" fill="#fff" opacity=".9"/>
  <rect x="-2" y="-35" width="4" height="6" fill="${C.skinD}"/>
  <g transform="translate(0 -45)"><g class="headanim">${head()}</g></g>
  <g transform="translate(-6 -24)">${arm('arm-f')}</g>
  <g class="x x-spark" fill="#FFC93C"><path d="M-6 -78 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z"/><path d="M8 -84 l1.2 2.6 2.6 1.2 -2.6 1.2 -1.2 2.6 -1.2 -2.6 -2.6 -1.2 2.6 -1.2z" fill="${C.teal}"/></g>
  <g class="x x-q"><text x="14" y="-60" font-size="15" font-weight="700" fill="${C.blue}" font-family="Segoe UI,sans-serif">?</text></g>
  <g class="x x-sweat"><path d="M13 -52 q-3 5 0 7 q3 -2 0 -7z" fill="#7FD3FF"/></g>
</g></g>
<g id="stand" class="hide"><g class="stbody">
  <g transform="translate(3 -66)">${arm('arm-b',true)}</g>
  <g transform="translate(-3.5 -40)">${leg('leg-a',C.navy)}</g>
  <g transform="translate(3.5 -40)">${leg('leg-b',C.navyD)}</g>
  <rect x="-10" y="-72" width="20" height="34" rx="7" fill="${C.teal}"/>
  <circle cx="-3" cy="-61" r="2.2" fill="#fff" opacity=".9"/>
  <rect x="-2" y="-76" width="4" height="6" fill="${C.skinD}"/>
  <g transform="translate(0 -86)"><g class="headanim">${head()}</g></g>
  <g class="armf-wrap" transform="translate(-3 -66)">${arm('arm-f')}</g>
  <g class="coffee-arm" transform="translate(-3 -66)"><g class="coffee-move">
    <rect x="-3.6" y="-2" width="7.2" height="12" rx="3.6" fill="${C.teal}"/>
    <path d="M0 9 L-7 -7" stroke="${C.skin}" stroke-width="5.2" stroke-linecap="round"/>
    <g transform="translate(-14 -18)">
      <g class="steam" fill="none" stroke="#A9B6C0" stroke-width="1" stroke-linecap="round"><path d="M3 -2 q-2 -3 0 -6 q2 -3 0 -6"/><path d="M6.5 -2 q-2 -3 0 -6"/></g>
      <rect width="9" height="10" rx="2.2" fill="#fff" stroke="${C.teal}" stroke-width="1.2"/>
    </g>
  </g></g>
  <g class="x x-alert"><circle cx="0" cy="-113" r="7.5" fill="#FF5A5F"/><text x="0" y="-109" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Segoe UI,sans-serif">!</text></g>
</g></g>
</svg>`;

// ── Module state ──────────────────────────────────────────────────────────────

const STATES = {
  typing:  {mode:'sit',   mouth:'smile'},
  happy:   {mode:'sit',   mouth:'open',  card:true},
  sticky:  {mode:'sit',   mouth:'smile', sticky:true},
  panic:   {mode:'sit',   mouth:'o',     scr:'scr-red'},
  confused:{mode:'sit',   mouth:'flat',  scr:'scr-gray'},
  stretch: {mode:'sit',   mouth:'o',     eyes:'closed'},
  alert:   {mode:'stand', spot:'desk',   mouth:'o', scr:'scr-flash'},
  walk:    {mode:'stand', spot:'walk',   mouth:'smile'},
  coffee:  {mode:'stand', spot:'coffee', mouth:'smile'},
  window:  {mode:'stand', spot:'window', mouth:'smile'},
  pullup:  {mode:'stand', spot:'pullup', mouth:'flat'},
  sleep:   {mode:'lie',                  mouth:'smile', eyes:'closed', scr:'scr-off'},
};
const SPOTS = {desk:{x:300,y:222,dir:1}, coffee:{x:146,y:222,dir:-1}, window:{x:150,y:222,dir:1}, pullup:{x:422,y:150,dir:1}};
const DOG_POSES = {sleep:{pose:'curl'}, lie:{pose:'lie'}, lick:{pose:'lie'}, sit:{pose:'sit'}, scratch:{pose:'sit'}, wash:{pose:'sit'}, stand:{pose:'stand'}};

let G = {mode:'sit', x:300, y:222, dir:1};
let token = 0;
let room, elSit, elStand, elLie, dogEl, bubbleEl, bubbleTimer;

function $q(sel) { return room.querySelector(sel); }
const wait = ms => new Promise(r => setTimeout(r, ms));

function yekMin() {
  const d = new Date();
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 300) % 1440;
}
function todNow() {
  const m = yekMin();
  if (m < 450) return 'night';
  if (m < 660) return 'morning';
  if (m < 1080) return 'day';
  if (m < 1320) return 'evening';
  return 'night';
}

// ── Scene manipulation ────────────────────────────────────────────────────────

function placeStand(x, y, dir, dur) {
  elStand.style.transition = dur ? `transform ${dur}s ease-in-out` : 'none';
  elStand.style.transform = `translate(${x}px,${y}px) scale(${dir},1)`;
  G.x = x; G.y = y; G.dir = dir;
}
function showOnly(m) {
  elSit.classList.toggle('hide', m !== 'sit');
  elStand.classList.toggle('hide', m !== 'stand');
  elLie.classList.toggle('hide', m !== 'lie');
  G.mode = m;
}
function setGs(name) {
  [...room.classList].filter(c => c.startsWith('gs-')).forEach(c => room.classList.remove(c));
  if (name) room.classList.add('gs-' + name);
}
function setScreen(cls) {
  room.classList.remove('scr-red', 'scr-gray', 'scr-off', 'scr-flash');
  if (cls) room.classList.add(cls);
}

async function walkTo(x, y, tk) {
  if (G.y !== 222) { placeStand(G.x, 222, G.dir, .45); await wait(460); if (tk !== token) return false; }
  const dist = Math.abs(x - G.x);
  if (dist > 2) {
    const dir = x < G.x ? 1 : -1, dur = Math.max(.5, dist / 110);
    room.classList.add('moving'); placeStand(x, 222, dir, dur);
    await wait(dur * 1000); room.classList.remove('moving');
    if (tk !== token) return false;
  }
  if (y !== 222) { placeStand(x, y, G.dir, .45); await wait(460); if (tk !== token) return false; }
  return true;
}
async function walkLoop(tk) {
  const pts = [170, 350, 240, 330, 190]; let i = 0;
  while (tk === token) {
    if (!await walkTo(pts[i++ % pts.length], 222, tk)) return;
    await wait(800);
  }
}
function leaveSeatOrCouch() {
  if (G.mode === 'sit')      { showOnly('stand'); placeStand(300, 222, 1, 0); }
  else if (G.mode === 'lie') { showOnly('stand'); placeStand(404, 222, 1, 0); }
}

async function setGirl(name, phraseText) {
  const tk = ++token;
  const s = STATES[name];
  if (!s) return;
  setGs(''); setScreen(''); room.classList.remove('moving'); hideBubble();
  if (s.mode === 'sit') {
    if (G.mode === 'lie') leaveSeatOrCouch();
    if (G.mode === 'stand') { if (!await walkTo(300, 222, tk)) return; }
    showOnly('sit');
  } else if (s.mode === 'stand') {
    leaveSeatOrCouch();
    if (s.spot === 'walk') {
      applyGirl(name, s);
      if (phraseText) say(phraseText);
      walkLoop(tk);
      return;
    }
    const sp = SPOTS[s.spot];
    if (!await walkTo(sp.x, sp.y, tk)) return;
    placeStand(sp.x, sp.y, sp.dir, 0);
  } else {
    if (G.mode === 'sit') leaveSeatOrCouch();
    if (G.mode === 'stand') { if (!await walkTo(404, 222, tk)) return; }
    showOnly('lie');
  }
  if (tk !== token) return;
  applyGirl(name, s);
  if (phraseText) say(phraseText);
}

function applyGirl(name, s) {
  setGs(name);
  room.dataset.mouth = s.mouth;
  room.dataset.eyes = s.eyes || 'open';
  setScreen(s.scr || '');
  if (s.card)   room.classList.toggle('card-moved');
  if (s.sticky) room.classList.add('has-sticky');
}

function setDog(name) {
  ['lie','curl','sit','stand'].forEach(p => dogEl.querySelector('.d-' + p).classList.toggle('hide', p !== DOG_POSES[name].pose));
  [...room.classList].filter(c => c.startsWith('da-')).forEach(c => room.classList.remove(c));
  room.classList.add('da-' + name);
}

function setTod(choice) {
  const tod = choice === 'now' ? todNow() : choice;
  room.classList.remove('tod-morning','tod-day','tod-evening','tod-night');
  room.classList.add('tod-' + tod);
  return tod;
}

function tickClock() {
  const m = yekMin();
  const hh = $q('#hh'), mm = $q('#mm');
  if (hh) hh.setAttribute('transform', `rotate(${(m/60%12)*30+(m%60)/2} 300 48)`);
  if (mm) mm.setAttribute('transform', `rotate(${(m%60)*6} 300 48)`);
}

function anchor() {
  if (G.mode === 'sit')  return [306, 124];
  if (G.mode === 'lie')  return [398, 160];
  return [G.x, G.y - 104];
}

function say(text) {
  const [x, y] = anchor();
  bubbleEl.textContent = text;
  const side = y < 90;
  bubbleEl.classList.toggle('side', side);
  if (side) {
    bubbleEl.style.left = ((x - 16) / 480 * 100) + '%';
    bubbleEl.style.top  = ((y + 40) / 270 * 100) + '%';
  } else {
    bubbleEl.style.left = Math.min(80, Math.max(20, x / 480 * 100)) + '%';
    bubbleEl.style.top  = Math.max(14, y / 270 * 100) + '%';
  }
  bubbleEl.hidden = false;
  bubbleEl.style.animation = 'none';
  void bubbleEl.offsetWidth;
  bubbleEl.style.animation = '';
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 5200);
}

function hideBubble() { bubbleEl.hidden = true; }

// ── init ──────────────────────────────────────────────────────────────────────

function init(wrapEl) {
  const sceneDiv = document.createElement('div');
  sceneDiv.id = 'ar-scene';
  sceneDiv.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
  sceneDiv.innerHTML = SVG_SRC;

  bubbleEl = document.createElement('div');
  bubbleEl.id = 'ar-bubble';
  bubbleEl.hidden = true;
  sceneDiv.appendChild(bubbleEl);

  wrapEl.appendChild(sceneDiv);

  room   = document.getElementById('room');
  elSit  = $q('#sit');
  elStand= $q('#stand');
  elLie  = $q('#lie');
  dogEl  = $q('#dog');

  showOnly('sit');
  applyGirl('typing', STATES.typing);
  setTod('now');
  tickClock();

  return room;
}

window.AgentScene = { init, setGirl, setDog, setTod, tickClock, say, hideBubble, getRoom: () => room };
}());
