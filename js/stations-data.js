/** Auto-generated from data/stations.json — do not hand-edit; regenerate via build. */
const STATIONS_DATA = {
  "_meta": {
    "pipelineId": "BETA",
    "name": "Oleoducto Beta · Puesto Hernández → Luján de Cuyo",
    "operator": "Simulación / entrenamiento (operador genérico)",
    "classification": "No Confidencial",
    "disclaimer": "Oleoducto Beta · simulación de entrenamiento con valores estimados. No es un SCADA en vivo ni dato contractual de ninguna operadora.",
    "lengthKm": 530,
    "diameterInch": 16,
    "maxFlowM3h": 900,
    "defaultPhCabeceraM3h": 680,
    "defaultLcReceiptTargetM3h": 760,
    "typicalFlowM3h_range": [
      600,
      730
    ],
    "pkStatus": "altimetry_slide_v3",
    "pkStatus_note": "PK/elevaciones desde altimetría PH-LC slide + datos bombeo. UG estimado (tramo UG–LC = 24 km ⇒ PK 506). Peak 198/1985 solo perfil HGL.",
    "stationListSource": "Altimetría PH-LC + DATOS DE BOMBEO + diagrama nodo PH",
    "pressureUnit": "kg/cm²",
    "sources": [
      "Altimetría PH-LC slide (PK/elev)",
      "DATOS DE BOMBEO (inyecciones captive)",
      "Anclas SCADA ejemplo entrenamiento @Q~430",
      "Diagrama nodo PH: 3 bombas principales + boosters · TK578"
    ],
    "injectionProfileModel": "Preferir tasas DATOS DE BOMBEO cuando ON; duty Excel opcional",
    "demo24h": {
      "simHoursPerRealSec": 0.2,
      "speedFactor": 720,
      "note": "1 h sim = 5 s real → 24 h en 120 s"
    },
    "dailyPlanM3d": 16500,
    "calibration": "v5: calibrado contra pantallas SCADA de operación a Q≈710 m³/h con DRA (presiones de aspiración y descarga por estación)",
    "maxLineFlowM3h": 750,
    "rampFlowM3hPerMin": 15,
    "rampStationMin": 8,
    "maxLineFlow_note": "Máximo de cabecera PH; LC recibe además las inyecciones (≈ 830 m³/h)",
    "pipeSpec": "16 in · presión máxima 90 kg/cm² · operación normal hasta 80 kg/cm²"
  },
  "hydraulics": {
    "model": "darcy_weisbach_plus_elevation_segment_f",
    "formula": "ΔP_fric=f_seg·(L/D)·(ρv²/2)/1e5; ΔP_elev=ρgΔz/1e5 (polyline altimetría); P_arr=P_up−ΔP_fric−ΔP_elev; P_desc=P_arr+boost",
    "diameterM": 0.4064,
    "diameterInch": 16,
    "frictionFactor_f": 0.038,
    "f_note": "f global de respaldo; el motor usa f por tramo calibrado a anclas SCADA entrenamiento",
    "segmentFriction": {
      "ph-ac": 0.0159,
      "ac-cd": 0.02616,
      "cd-mg": 0.02993,
      "mg-sos": 0.03101,
      "sos-pa": 0.02829,
      "pa-rt": 0.03766,
      "rt-ug": 0.03127,
      "ug-lc": 0.02062,
      "note": "v5: f por tramo calibrado contra SCADA de operación a Q≈710 m³/h con DRA 6 L/h"
    },
    "fluidDensity_kg_m3": 860,
    "fluidDensity_sg": 0.86,
    "atmosphereKgCm2": 1.033,
    "minPressureKgCm2": 2,
    "maxPressureKgCm2": 90,
    "phMaxDischargeKgCm2": 90,
    "pressureUnit": "kg/cm²",
    "scadaAnchors_training": {
      "note": "Ejemplos SCADA entrenamiento @Q~430 — no contractual",
      "Q_m3h": 430,
      "ph_disc": 85,
      "ac_suc": 4,
      "ac_disc": 59,
      "cd_suc": 10,
      "cd_disc": 78,
      "cd_flow": 528,
      "es_suc": 4,
      "es_disc": 79,
      "es_flow": 490,
      "rt_suc": 33,
      "rt_disc": 50,
      "rt_flow": 502,
      "lc_arrival": [
        5,
        8
      ]
    },
    "draFrictionReduction": 0.35,
    "draRefLph": 10,
    "dra_note": "DRA/polímero 6–10 L/h: baja ΔP fricción, más capacidad o mismo Q con menor P_desc; soft-clamp P_desc ~85. Sin DRA: pérdida alta, más cerca MAOP, menos entregabilidad."
  },
  "thresholds": {
    "label": "operativo / no contractual — UI editable",
    "pAspMinKgCm2_default": 4,
    "pAspMinKgCm2_range": [
      3,
      5
    ],
    "maopAlarmFraction": 0.9,
    "maopTripFraction": 1,
    "lcReceiptTargetM3h": 760,
    "lcReceiptBandM3h": 90,
    "lcArrivalTargetKgCm2": 8,
    "waterSlugOosPct": 0.75,
    "waterSlugWarnPct": 0.5,
    "pigVminKmH": 1.5,
    "pigStuckMinutes": 15,
    "operatorResponseDelayMin": 5,
    "cdAutonomyHours": 2,
    "npshProxy": {
      "pAspWarnKgCm2": 5,
      "qHighFraction": 0.85
    },
    "pDescMaxKgCm2": 90,
    "draDefaultLph": 6,
    "pMinLineKgCm2": 2,
    "pMaxLineKgCm2": 90,
    "pAspAlarmKgCm2": 4.5,
    "pAspStrongKgCm2": 3.5,
    "pAspTripKgCm2": 2.5,
    "pAspAlarmDerateFrac": 0.15,
    "draMaxLph": 10,
    "note_pAsp": "Operativo/no contractual: alarma 5→derate 10–20%; fuerte 4→corta iny no críticas; trip 3→para EB + estrategia global; multi-EB asp → parada ordenada ducto"
  },
  "segments": [
    {
      "id": "ph-cd",
      "from": "ph",
      "to": "cd",
      "via": [
        "ac"
      ],
      "lengthKm": 167,
      "qMaxM3h": 820,
      "qMaxDraM3h": 820,
      "maopKgCm2": 90,
      "maop_note": "Ducto 16 in: máximo 90 kg/cm² (dato del operador)",
      "linepackM3": 21500,
      "tablaRef_qMaxSinDra": 560,
      "tablaRef_qMaxConDra": 620
    },
    {
      "id": "cd-sos",
      "from": "cd",
      "to": "sos",
      "via": [
        "mg"
      ],
      "lengthKm": 136,
      "qMaxM3h": 820,
      "qMaxDraM3h": 820,
      "maopKgCm2": 90,
      "maop_note": "Ducto 16 in: máximo 90 kg/cm² (dato del operador)",
      "linepackM3": 17500,
      "tablaRef_qMaxSinDra": 550,
      "tablaRef_qMaxConDra": 650
    },
    {
      "id": "sos-ug",
      "from": "sos",
      "to": "ug",
      "via": [
        "pa",
        "rt"
      ],
      "lengthKm": 204,
      "qMaxM3h": 820,
      "qMaxDraM3h": 820,
      "maopKgCm2": 90,
      "maop_note": "Ducto 16 in: máximo 90 kg/cm² (dato del operador)",
      "linepackM3": 26300,
      "tablaRef_qMaxSinDra": 585,
      "tablaRef_qMaxConDra": 675
    },
    {
      "id": "ug-lc",
      "from": "ug",
      "to": "lc",
      "via": [],
      "lengthKm": 24,
      "qMaxM3h": 820,
      "qMaxDraM3h": 820,
      "maopKgCm2": 90,
      "maop_note": "Ducto 16 in: máximo 90 kg/cm² (dato del operador)",
      "linepackM3": 3100,
      "tablaRef_qMaxSinDra": 620,
      "tablaRef_qMaxConDra": 750
    }
  ],
  "altimetryPolyline": [
    {
      "pkKm": 0,
      "elevMsnm": 650,
      "label": "PH"
    },
    {
      "pkKm": 10,
      "elevMsnm": 670
    },
    {
      "pkKm": 18,
      "elevMsnm": 760
    },
    {
      "pkKm": 30,
      "elevMsnm": 950
    },
    {
      "pkKm": 45,
      "elevMsnm": 1060
    },
    {
      "pkKm": 55,
      "elevMsnm": 1200
    },
    {
      "pkKm": 65,
      "elevMsnm": 1320,
      "label": "AC"
    },
    {
      "pkKm": 72,
      "elevMsnm": 1560
    },
    {
      "pkKm": 80,
      "elevMsnm": 1570
    },
    {
      "pkKm": 90,
      "elevMsnm": 1360
    },
    {
      "pkKm": 100,
      "elevMsnm": 1100
    },
    {
      "pkKm": 110,
      "elevMsnm": 1190
    },
    {
      "pkKm": 120,
      "elevMsnm": 1320
    },
    {
      "pkKm": 135,
      "elevMsnm": 1300
    },
    {
      "pkKm": 150,
      "elevMsnm": 1420
    },
    {
      "pkKm": 160,
      "elevMsnm": 1500,
      "label": "CD"
    },
    {
      "pkKm": 170,
      "elevMsnm": 1520
    },
    {
      "pkKm": 178,
      "elevMsnm": 1700
    },
    {
      "pkKm": 188,
      "elevMsnm": 1880
    },
    {
      "pkKm": 198,
      "elevMsnm": 1985,
      "label": "Peak",
      "profileOnly": true
    },
    {
      "pkKm": 205,
      "elevMsnm": 1700
    },
    {
      "pkKm": 212,
      "elevMsnm": 1560
    },
    {
      "pkKm": 218,
      "elevMsnm": 1600
    },
    {
      "pkKm": 226,
      "elevMsnm": 1420
    },
    {
      "pkKm": 240,
      "elevMsnm": 1430,
      "label": "MG"
    },
    {
      "pkKm": 260,
      "elevMsnm": 1470
    },
    {
      "pkKm": 272,
      "elevMsnm": 1520
    },
    {
      "pkKm": 283,
      "elevMsnm": 1580
    },
    {
      "pkKm": 295,
      "elevMsnm": 1500
    },
    {
      "pkKm": 305,
      "elevMsnm": 1470,
      "label": "SOS"
    },
    {
      "pkKm": 318,
      "elevMsnm": 1650
    },
    {
      "pkKm": 330,
      "elevMsnm": 1780
    },
    {
      "pkKm": 345,
      "elevMsnm": 1520
    },
    {
      "pkKm": 353,
      "elevMsnm": 1430
    },
    {
      "pkKm": 360,
      "elevMsnm": 1620
    },
    {
      "pkKm": 375,
      "elevMsnm": 1850
    },
    {
      "pkKm": 385,
      "elevMsnm": 1800
    },
    {
      "pkKm": 400,
      "elevMsnm": 1580
    },
    {
      "pkKm": 420,
      "elevMsnm": 1300
    },
    {
      "pkKm": 435,
      "elevMsnm": 1100,
      "label": "PA"
    },
    {
      "pkKm": 450,
      "elevMsnm": 1060
    },
    {
      "pkKm": 465,
      "elevMsnm": 1000
    },
    {
      "pkKm": 475,
      "elevMsnm": 950,
      "label": "RT"
    },
    {
      "pkKm": 485,
      "elevMsnm": 900
    },
    {
      "pkKm": 498,
      "elevMsnm": 1030
    },
    {
      "pkKm": 506,
      "elevMsnm": 1050,
      "label": "UG"
    },
    {
      "pkKm": 518,
      "elevMsnm": 1080
    },
    {
      "pkKm": 530,
      "elevMsnm": 1100,
      "label": "LC"
    }
  ],
  "valves": [
    {
      "id": "vb01",
      "name": "VB01",
      "pkKm": 3,
      "open": true
    },
    {
      "id": "vb02",
      "name": "VB02",
      "pkKm": 10,
      "open": true
    },
    {
      "id": "vb03",
      "name": "VB03",
      "pkKm": 88,
      "open": true
    },
    {
      "id": "vb04",
      "name": "VB04",
      "pkKm": 115,
      "open": true
    },
    {
      "id": "vb05",
      "name": "VB05",
      "pkKm": 143,
      "open": true
    },
    {
      "id": "vb06",
      "name": "VB06",
      "pkKm": 178,
      "open": true
    },
    {
      "id": "vb07",
      "name": "VB07",
      "pkKm": 212,
      "open": true
    },
    {
      "id": "vb08",
      "name": "VB08",
      "pkKm": 226,
      "open": true
    },
    {
      "id": "vb08b",
      "name": "VB08 bis",
      "pkKm": 232,
      "open": true
    },
    {
      "id": "vb09",
      "name": "VB09",
      "pkKm": 270,
      "open": true
    },
    {
      "id": "vb10",
      "name": "VB10",
      "pkKm": 274,
      "open": true
    },
    {
      "id": "vb11",
      "name": "VB11",
      "pkKm": 281,
      "open": true
    },
    {
      "id": "vb12",
      "name": "VB12",
      "pkKm": 285,
      "open": true
    },
    {
      "id": "vb13",
      "name": "VB13",
      "pkKm": 350,
      "open": true
    },
    {
      "id": "vb14",
      "name": "VB14",
      "pkKm": 352,
      "open": true
    },
    {
      "id": "vb15",
      "name": "VB15",
      "pkKm": 358,
      "open": true
    },
    {
      "id": "vb16",
      "name": "VB16",
      "pkKm": 361,
      "open": true
    },
    {
      "id": "vb17",
      "name": "VB17",
      "pkKm": 400,
      "open": true
    },
    {
      "id": "vb18",
      "name": "VB18 · Pareditas",
      "pkKm": 433,
      "open": true
    },
    {
      "id": "vb19",
      "name": "VB19",
      "pkKm": 482,
      "open": true
    },
    {
      "id": "vb20",
      "name": "VB20",
      "pkKm": 486,
      "open": true
    },
    {
      "id": "vb21",
      "name": "VB21",
      "pkKm": 490,
      "open": true
    }
  ],
  "playbook": {
    "falla_ph": [
      "Reducir setpoint caudal línea",
      "Confirmar autonomía tanque CD (hasta 2 h)",
      "Activar CD como cabecera temporal",
      "Abrir DRA en tramos críticos si P_desc alto",
      "Aislar VB aguas abajo de PH si despresurización",
      "Notificar CILC / sala de control",
      "Monitorear P_asp estaciones intermedias"
    ],
    "falla_eb": [
      "Evaluar P_asp / P_desc estación afectada",
      "Derate Q o redistribuir caudal",
      "Verificar alarma succión baja / posible reverso",
      "Abrir DRA si tramo aguas abajo lo requiere",
      "Aislar VB adyacentes si fuga/aislamiento",
      "Notificar CILC"
    ],
    "pig": [
      "Completar SOP lanzamiento",
      "Seguir PK / ETA / ΔP fore-aft",
      "Si v < vmin por T min → stuck",
      "Coordinar recepción LDC"
    ],
    "calidad_agua": [
      "Si agua > 0.5–1% en LC → OOS calidad",
      "Reducir inyecciones upstream",
      "Notificar lab / CILC"
    ],
    "estrategia_global": [
      "Activar estrategia global por falla / parada de EB / P_asp trip",
      "Evaluar alcance hidráulico (PH→AC→CD→peak→LC)",
      "Verificar bombas mínimas: PH×2 · demás EB×2 · CD×3 turbos en línea (1 reserva)",
      "Boosters PH = aspiración post-medición (PIPH/UM), no cuentan como principales",
      "Ajustar setpoint / DRA (6–10 L/h) / Pareditas (regulación)",
      "Monitorear P_asp (5/4/3) / P_desc y P_mín de tramo",
      "Notificar CILC / sala de control",
      "Actualizar impacto gerencia (m³/h, USD, ΔQ_LC, ΔP_desc)"
    ],
    "fuga_rotura": [
      "Confirmar PK de fuga / rotura y caída local de P",
      "Aislar VB adyacentes del tramo afectado",
      "Parar bombas afectadas / no rearrancar hasta integridad OK",
      "Evaluar linepack imbalance y Q_LC",
      "Notificar CILC / integridad / medio ambiente",
      "Esperar OK integridad antes de restablecer"
    ],
    "perdida_electrica": [
      "Confirmar pérdida eléctrica en EB (P_desc→0)",
      "Redistribuir caudal / limitar Q",
      "Si PH: activar CD cabecera temporal (≤2 h)",
      "Abrir DRA si P_desc aguas abajo lo requiere",
      "Notificar CILC / mantenimiento eléctrico"
    ],
    "pig_stuck_peak": [
      "Confirmar pig stuck cerca PK 198 (peak)",
      "v≈0 · ΔP detrás↑ · Q↓",
      "Empuje controlado — vigilar MAOP",
      "No forzar si P > 90% MAOP",
      "Coordinar recepción / rescate"
    ],
    "sobrepresion_surge": [
      "Sobrepresión post-parada (surge) detectada",
      "Soft stop / ramp — no rearrancar en frío",
      "Esperar normalización de P",
      "Verificar MAOP / P_máx línea",
      "Notificar CILC"
    ]
  },
  "stations": [
    {
      "id": "ph",
      "name": "Puesto Hernández (EECC)",
      "shortName": "PH",
      "code": "712000",
      "layoutOrder": 1,
      "pkKm": 0,
      "pkIsPlaceholder": false,
      "elevationMsnm": 650,
      "elevation_note": "Altimetría PH-LC slide — real",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 0",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "cabecera",
      "roles": [
        "pig_launcher",
        "injection_hub",
        "pumping"
      ],
      "opsNote": "Cabecera · 3 bombas principales (2 en línea alcanzan) + boosters aspiración post-PIPH/UM · buffer TK578 · tip. ~650 m³/h → ~800 LC con inyecciones",
      "pAspMinKgCm2": 4,
      "qMinM3h": 200,
      "qMaxM3h": 850,
      "tankBuffer": {
        "id": "TK578",
        "name": "TK578",
        "note": "Buffer cabecera PH (diagrama nodo PH)",
        "autonomyHoursExample": 1.5
      },
      "pumps": [
        {
          "id": "ph-151a",
          "name": "B-151A",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 40.75,
          "drive": "directa"
        },
        {
          "id": "ph-151b",
          "name": "B-151B",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 40.75,
          "reserve": true,
          "drive": "directa"
        },
        {
          "id": "ph-151c",
          "name": "B-151C",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 40.75,
          "drive": "directa"
        },
        {
          "id": "ph-152a",
          "name": "B-152A (booster)",
          "role": "booster_suction",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 0,
          "suctionAssistKgCm2": 6
        },
        {
          "id": "ph-152b",
          "name": "B-152B (booster)",
          "role": "booster_suction",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 0,
          "suctionAssistKgCm2": 5,
          "reserve": true
        }
      ],
      "pigTrap": {
        "type": "lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": {
        "enabled": true,
        "rateM3h": 0,
        "maxM3h": 200,
        "label": "Inyección cabecera PH",
        "note": "EDITABLE"
      },
      "injections": [
        {
          "id": "ph-hub",
          "name": "Inyección cabecera PH",
          "enabled": true,
          "mode": "continuous",
          "rateM3h": 0,
          "maxM3h": 200,
          "manualOverride": true,
          "manualRateM3h": 0,
          "note": "Hub cabecera"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 2,
      "pDescSpKgCm2": 80,
      "pDescSp_note": "Máximo en cabecera 80 kg/cm²"
    },
    {
      "id": "ac",
      "name": "Aguas del Carrizo",
      "shortName": "AC",
      "aliases": [
        "ADC",
        "adc"
      ],
      "code": "712000",
      "layoutOrder": 2,
      "pkKm": 65,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1320,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 65",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "pumping",
      "roles": [
        "pumping",
        "injection"
      ],
      "opsNote": "Inyección Aconcagua intermitente ~40 m³/h · ancla suc~4 disc~59 @Q~430 · Requiere 2 bombas en línea para alcanzar Divisadero/peak · 3 bombas (2 en línea + 1 reserva)",
      "pAspMinKgCm2": 4,
      "qMinM3h": 150,
      "qMaxM3h": 850,
      "pumps": [
        {
          "id": "ac-201d",
          "name": "B-201D",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 34.1,
          "drive": "directa"
        },
        {
          "id": "ac-201e",
          "name": "B-201E",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 34.1,
          "drive": "variador"
        },
        {
          "id": "ac-201f",
          "name": "B-201F",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 34.1,
          "reserve": true,
          "drive": "directa"
        }
      ],
      "pigTrap": {
        "type": "receptora/lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": {
        "enabled": true,
        "rateM3h": 0,
        "maxM3h": 50,
        "label": "Aconcagua",
        "note": "DATOS DE BOMBEO ~40 m³/h intermitente"
      },
      "injections": [
        {
          "id": "ac-aconcagua",
          "name": "Aconcagua",
          "enabled": true,
          "mode": "intermittent",
          "rateM3h": 40,
          "maxM3h": 50,
          "manualOverride": true,
          "manualRateM3h": 0,
          "datosBombeoRateM3h": 40,
          "datosBombeoNote": "~40 m³/h intermitente · ~3000 m³/mes",
          "schedule": {
            "enabled": true,
            "model": "duty_cycle",
            "preferDatosBombeo": true,
            "dutyCycle": 0.25,
            "rateWhenOnM3h": 40,
            "periodHours": 24,
            "onHours": 6,
            "excelDutyCycle": 0.253,
            "excelRateWhenOnM3h": 16.77,
            "source": "DATOS DE BOMBEO (preferido) + Excel duty opcional",
            "phaseOffsetHours": 3
          },
          "excelTypicalM3day": 402.4,
          "excelDaysActive": 63,
          "excelDaysTotal": 249,
          "note": "Intermitente · en 0 por defecto (habilitar desde la consola)"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 2,
      "pAspSpKgCm2": 5.0,
      "pDescSpKgCm2": 76
    },
    {
      "id": "cd",
      "name": "Cerro Divisadero",
      "shortName": "CD",
      "code": "711800",
      "layoutOrder": 3,
      "pkKm": 160,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1500,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 160",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "pumping",
      "roles": [
        "pumping",
        "injection",
        "temp_head"
      ],
      "opsNote": "4 turbobombas · 3 en línea requeridas para pasar peak hacia LC · 1 reserva · inyección continua ~50 m³/h · cabecera temporal hasta 2 h si falla PH",
      "pAspMinKgCm2": 4,
      "qMinM3h": 200,
      "qMaxM3h": 850,
      "tankAutonomyHours": 2,
      "tankAutonomy_note": "Autonomía tanque CD como cabecera temporal — param editable",
      "pumps": [
        {
          "id": "cd-301a",
          "name": "B-301A",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 21.5,
          "drive": "turbina"
        },
        {
          "id": "cd-301b",
          "name": "B-301B",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 21.5,
          "drive": "turbina"
        },
        {
          "id": "cd-301c",
          "name": "B-301C",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 21.5,
          "reserve": true,
          "drive": "turbina"
        },
        {
          "id": "cd-301d",
          "name": "B-301D",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 21.5,
          "drive": "turbina"
        },
        {
          "id": "cd-304a",
          "name": "B-304A (booster)",
          "role": "booster_suction",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 0,
          "suctionAssistKgCm2": 3
        },
        {
          "id": "cd-304b",
          "name": "B-304B (booster)",
          "role": "booster_suction",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 0,
          "suctionAssistKgCm2": 3,
          "reserve": true
        }
      ],
      "pigTrap": {
        "type": "receptora/lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": {
        "enabled": true,
        "rateM3h": 50,
        "maxM3h": 70,
        "label": "Divisadero",
        "note": "Continua ~50 m³/h (~1200 m³/d) + condensado 40 m³/d"
      },
      "injections": [
        {
          "id": "cd-main",
          "name": "Divisadero (continua)",
          "enabled": true,
          "mode": "continuous",
          "rateM3h": 50,
          "maxM3h": 70,
          "manualOverride": false,
          "manualRateM3h": 50,
          "datosBombeoRateM3h": 50,
          "datosBombeoNote": "Continua ~50 m³/h (~1200 m³/d)",
          "note": "DATOS DE BOMBEO — continua"
        },
        {
          "id": "cd-condensate",
          "name": "Condensado CD",
          "enabled": false,
          "mode": "continuous",
          "rateM3h": 1.67,
          "maxM3h": 5,
          "manualOverride": false,
          "manualRateM3h": 1.67,
          "datosBombeoNote": "Condensado ~40 m³/d ≈ 1.67 m³/h",
          "note": "40 m³/d condensado"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "minTurbosForPeak": 3,
      "draInjectOn": false,
      "minMainsOnline": 3,
      "pAspSpKgCm2": 10.0,
      "pDescSpKgCm2": 76.5
    },
    {
      "id": "mg",
      "name": "Malargüe",
      "shortName": "ML",
      "aliases": [
        "MAL",
        "ML"
      ],
      "code": "711600",
      "layoutOrder": 4,
      "pkKm": 240,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1430,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 240",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "pumping",
      "roles": [
        "pumping",
        "injection"
      ],
      "opsNote": "PCR 20–40 + Hattrick 15–20 m³/h intermitentes · 3 bombas (2 en línea + 1 reserva)",
      "pAspMinKgCm2": 4,
      "qMinM3h": 150,
      "qMaxM3h": 850,
      "pumps": [
        {
          "id": "mg-401a",
          "name": "B-401A",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 30.6,
          "drive": "variador"
        },
        {
          "id": "mg-401b",
          "name": "B-401B",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 30.6,
          "reserve": true,
          "drive": "variador"
        }
      ],
      "pigTrap": {
        "type": "receptora/lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": {
        "enabled": true,
        "rateM3h": 0,
        "maxM3h": 60,
        "label": "Malargüe PCR",
        "note": "DATOS DE BOMBEO"
      },
      "injections": [
        {
          "id": "mg-pcr",
          "name": "Malargüe PCR",
          "enabled": true,
          "mode": "intermittent",
          "rateM3h": 30,
          "maxM3h": 45,
          "manualOverride": true,
          "manualRateM3h": 0,
          "datosBombeoRateM3h": 30,
          "datosBombeoNote": "PCR 20–40 m³/h intermitente",
          "schedule": {
            "enabled": true,
            "model": "duty_cycle",
            "preferDatosBombeo": true,
            "dutyCycle": 0.4,
            "rateWhenOnM3h": 30,
            "periodHours": 24,
            "onHours": 9.6,
            "excelDutyCycle": 0.4016,
            "excelRateWhenOnM3h": 6.75,
            "source": "DATOS DE BOMBEO preferido",
            "phaseOffsetHours": 8
          },
          "excelTypicalM3day": 162.1,
          "excelDaysActive": 100,
          "excelDaysTotal": 249,
          "note": "Intermitente · en 0 por defecto (habilitar desde la consola)"
        },
        {
          "id": "mg-hattrick",
          "name": "Malargüe Hattrick",
          "enabled": true,
          "mode": "intermittent",
          "rateM3h": 18,
          "maxM3h": 25,
          "manualOverride": true,
          "manualRateM3h": 0,
          "datosBombeoRateM3h": 18,
          "datosBombeoNote": "Hattrick 15–20 m³/h intermitente",
          "schedule": {
            "enabled": true,
            "model": "duty_cycle",
            "preferDatosBombeo": true,
            "dutyCycle": 0.5,
            "rateWhenOnM3h": 18,
            "periodHours": 24,
            "onHours": 12,
            "excelDutyCycle": 0.5341,
            "excelRateWhenOnM3h": 11.1,
            "source": "DATOS DE BOMBEO preferido",
            "phaseOffsetHours": 14
          },
          "excelTypicalM3day": 266.5,
          "excelDaysActive": 133,
          "excelDaysTotal": 249,
          "note": "Intermitente · en 0 por defecto (habilitar desde la consola)"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 1,
      "pAspSpKgCm2": 8.0,
      "pDescSpKgCm2": 80
    },
    {
      "id": "sos",
      "name": "El Sosneado",
      "shortName": "ES",
      "aliases": [
        "SOS",
        "ES"
      ],
      "code": "711500",
      "layoutOrder": 5,
      "pkKm": 305,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1470,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 305",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "pumping",
      "roles": [
        "pumping",
        "injection"
      ],
      "opsNote": "EMESA ~20 · PCR ~20 intermitente · ancla suc~4 disc~79 · 3 bombas (2 en línea + 1 reserva)",
      "pAspMinKgCm2": 4,
      "qMinM3h": 150,
      "qMaxM3h": 850,
      "pumps": [
        {
          "id": "sos-1101d",
          "name": "B-1101D",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 36.95,
          "drive": "directa"
        },
        {
          "id": "sos-1101e",
          "name": "B-1101E",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 36.95,
          "drive": "variador"
        },
        {
          "id": "sos-1101f",
          "name": "B-1101F",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 36.95,
          "reserve": true,
          "drive": "directa"
        }
      ],
      "pigTrap": {
        "type": "receptora/lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": {
        "enabled": true,
        "rateM3h": 0,
        "maxM3h": 50,
        "label": "Sosneado PCR",
        "note": "DATOS DE BOMBEO"
      },
      "injections": [
        {
          "id": "sos-emesa",
          "name": "Sosneado EMESA",
          "enabled": true,
          "mode": "intermittent",
          "rateM3h": 20,
          "maxM3h": 30,
          "manualOverride": true,
          "manualRateM3h": 0,
          "datosBombeoRateM3h": 20,
          "datosBombeoNote": "EMESA ~20 m³/h",
          "schedule": {
            "enabled": true,
            "model": "duty_cycle",
            "preferDatosBombeo": true,
            "dutyCycle": 0.35,
            "rateWhenOnM3h": 20,
            "periodHours": 24,
            "onHours": 8.4,
            "excelDutyCycle": 0.2892,
            "excelRateWhenOnM3h": 3.89,
            "source": "DATOS DE BOMBEO preferido",
            "phaseOffsetHours": 5
          },
          "excelTypicalM3day": 93.4,
          "excelDaysActive": 72,
          "excelDaysTotal": 249,
          "note": "Intermitente · en 0 por defecto (habilitar desde la consola)"
        },
        {
          "id": "sos-pcr",
          "name": "Sosneado PCR",
          "enabled": true,
          "mode": "intermittent",
          "rateM3h": 20,
          "maxM3h": 30,
          "manualOverride": true,
          "manualRateM3h": 0,
          "datosBombeoRateM3h": 20,
          "datosBombeoNote": "PCR ~20 m³/h intermitente",
          "schedule": {
            "enabled": true,
            "model": "duty_cycle",
            "preferDatosBombeo": true,
            "dutyCycle": 0.25,
            "rateWhenOnM3h": 20,
            "periodHours": 24,
            "onHours": 6,
            "excelDutyCycle": 0.2008,
            "excelRateWhenOnM3h": 16.3,
            "source": "DATOS DE BOMBEO preferido",
            "phaseOffsetHours": 18
          },
          "excelTypicalM3day": 391.1,
          "excelDaysActive": 50,
          "excelDaysTotal": 249,
          "note": "Intermitente · en 0 por defecto (habilitar desde la consola)"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 2,
      "pAspSpKgCm2": 10.0,
      "pDescSpKgCm2": 88
    },
    {
      "id": "pa",
      "name": "Pareditas",
      "shortName": "PA",
      "code": null,
      "layoutOrder": 6,
      "pkKm": 435,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1100,
      "elevation_note": "Nodo regulador altimétrico entre SOS y RT",
      "pk_note": "Nodo válvula opcional ~VB19 entre SOS y RT",
      "source": "estimación layout (valve-only)",
      "type": "regulating",
      "roles": [
        "regulating",
        "valve",
        "altimetry_throttle"
      ],
      "opsNote": "Nodo de válvula VB18 · cálculo de paso de scraper · sin bombeo",
      "pumps": [],
      "pigTrap": null,
      "injection": null,
      "injections": [],
      "draInjectionLph": 6,
      "draCapable": true,
      "flowThrottlePct": 100,
      "draInjectOn": false
    },
    {
      "id": "rt",
      "name": "Río Tunuyán",
      "shortName": "RT",
      "aliases": [
        "TUN"
      ],
      "code": null,
      "layoutOrder": 7,
      "pkKm": 475,
      "pkIsPlaceholder": false,
      "elevationMsnm": 950,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 475 · estación de bombeo COMPLETA (B-701)",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "pumping",
      "roles": [
        "pumping"
      ],
      "opsNote": "Estación de bombeo completa · bombas B-701 · ancla suc~33 disc~50 · 3 bombas (2 en línea + 1 reserva)",
      "pAspMinKgCm2": 5,
      "qMinM3h": 200,
      "qMaxM3h": 850,
      "pumps": [
        {
          "id": "rt-701a",
          "name": "B-701A",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 40.8,
          "reserve": true,
          "drive": "directa"
        },
        {
          "id": "rt-701b",
          "name": "B-701B",
          "role": "main",
          "online": true,
          "powerFraction": 1,
          "boostKgCm2": 40.8,
          "drive": "variador"
        },
        {
          "id": "rt-701c",
          "name": "B-701C",
          "role": "main",
          "online": false,
          "powerFraction": 1,
          "boostKgCm2": 40.8,
          "reserve": true,
          "drive": "directa"
        }
      ],
      "pigTrap": {
        "type": "receptora/lanzadora",
        "status": "ready",
        "occupied": false
      },
      "injection": null,
      "injections": [],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 1,
      "pAspSpKgCm2": 13.0,
      "pDescSpKgCm2": 62
    },
    {
      "id": "ug",
      "name": "Ugarteche",
      "shortName": "UG",
      "aliases": [
        "UGA"
      ],
      "code": "711000",
      "layoutOrder": 8,
      "pkKm": 506,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1050,
      "elevation_note": "Estimación entre RT(900) y LC(1100)",
      "pk_note": "Estimación: tramo UG–LC = 24 km ⇒ PK = 530−24 = 506",
      "source": "estimación (UG–LC 24 km)",
      "type": "injection",
      "roles": [
        "injection"
      ],
      "opsNote": "Nodo de medición e inyección continua ~18–20 m³/h · sin bombeo",
      "pAspMinKgCm2": 4,
      "qMinM3h": 200,
      "qMaxM3h": 850,
      "pumps": [],
      "pigTrap": null,
      "injection": {
        "enabled": true,
        "rateM3h": 20,
        "maxM3h": 40,
        "label": "Ugarteche",
        "note": "Continua ~20 m³/h"
      },
      "injections": [
        {
          "id": "ug-inj",
          "name": "Ugarteche",
          "enabled": true,
          "mode": "continuous",
          "rateM3h": 18,
          "maxM3h": 40,
          "manualOverride": false,
          "manualRateM3h": 18,
          "datosBombeoRateM3h": 18,
          "datosBombeoNote": "Continua ~20 m³/h (~480 m³/d)",
          "excelTypicalM3day": 2952.5,
          "excelDaysActive": 36,
          "excelDaysTotal": 249,
          "excelNote": "Excel duty opcional (histórico distinto); preferir DATOS DE BOMBEO continua 20"
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "minMainsOnline": 2
    },
    {
      "id": "lc",
      "name": "Luján de Cuyo (EETT)",
      "shortName": "LC",
      "aliases": [
        "LDC",
        "ldc"
      ],
      "code": "716700",
      "layoutOrder": 9,
      "pkKm": 530,
      "pkIsPlaceholder": false,
      "elevationMsnm": 1100,
      "elevation_note": "Altimetría PH-LC slide",
      "pk_note": "Altimetría PH-LC slide / datos bombeo — PK 530",
      "source": "altimetría PH-LC slide / datos bombeo",
      "type": "terminal",
      "roles": [
        "pig_receiver",
        "tank_farm",
        "terminal"
      ],
      "opsNote": "Recepción · target ~800 m³/h (Raúl) · llegada tip. 5–8 kg/cm²",
      "pAspMinKgCm2": 3,
      "qMinM3h": 400,
      "qMaxM3h": 850,
      "receiptTargetM3h": 800,
      "pumps": [],
      "pigTrap": {
        "type": "receptora",
        "status": "ready",
        "occupied": false
      },
      "injection": null,
      "injections": [],
      "tanks": [
        {
          "id": "tk-01",
          "name": "TK-01",
          "capacityM3": 20000,
          "maxOpM3": 17500,
          "minOpM3": 4000,
          "volumeM3": 11200,
          "mode": "recibe",
          "capacity_note": "Supuesto: 20.000 m³ nominal, 17.500 máx. operativo, 13.500 extraíble",
          "levelPct": 56.00000000000001
        },
        {
          "id": "tk-02",
          "name": "TK-02",
          "capacityM3": 20000,
          "maxOpM3": 17500,
          "minOpM3": 4000,
          "volumeM3": 9800,
          "mode": "entrega",
          "capacity_note": "Supuesto: 20.000 m³ nominal, 17.500 máx. operativo, 13.500 extraíble",
          "levelPct": 49.0
        }
      ],
      "draInjectionLph": 6,
      "draCapable": true,
      "draInjectOn": false,
      "pAspSpKgCm2": 8.0
    }
  ],
  "refinery": {
    "name": "Refinería (CILC)",
    "programM3d": 16500,
    "note": "Programa de carga de crudo desde la terminal LC (85 % del crudo procesado)",
    "settleHours": 6
  },
  "pigTypes": [
    {
      "id": "limpieza",
      "name": "Limpieza (discos y cepillos)",
      "speedFactor": 0.95,
      "dP": 1.8,
      "stuckRisk": 0.25,
      "note": "Remueve parafina y sedimentos: baja la fricción del tramo recorrido"
    },
    {
      "id": "espuma",
      "name": "Espuma (foam)",
      "speedFactor": 1.0,
      "dP": 0.6,
      "stuckRisk": 0.02,
      "note": "Baja exigencia: primera corrida o tramos con dudas de diámetro"
    },
    {
      "id": "copas",
      "name": "Copas (separador de batch)",
      "speedFactor": 0.98,
      "dP": 1.2,
      "stuckRisk": 0.08,
      "note": "Separa productos o empuja agua y sedimentos"
    },
    {
      "id": "calibrador",
      "name": "Calibrador (placa)",
      "speedFactor": 0.97,
      "dP": 1.4,
      "stuckRisk": 0.1,
      "note": "Verifica que no haya abolladuras antes de un instrumentado"
    },
    {
      "id": "instrumentado",
      "name": "Instrumentado (MFL / geómetra)",
      "speedFactor": 0.9,
      "dP": 2.2,
      "stuckRisk": 0.15,
      "note": "Inspección en línea: pide velocidad estable de 1 a 4 m/s",
      "vMinMs": 1.0,
      "vMaxMs": 4.0
    }
  ]
};
