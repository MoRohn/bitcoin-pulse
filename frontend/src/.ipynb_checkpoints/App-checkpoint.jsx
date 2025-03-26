import React, { useEffect, useState, useRef, useMemo } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, ResponsiveContainer, LabelList } from 'recharts';
import { motion, useAnimation } from 'framer-motion';

// A custom hook to animate a "time" value continuously using requestAnimationFrame.
function useAnimatedTime(speed = 1) {
    const [time, setTime] = useState(0);
    const rafRef = useRef(null);
    
    useEffect(() => {
    const animate = (t) => {
        setTime(prev => prev + 0.02 * speed); 
        rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
    }, [speed]);
    
    return time;
}

function generateWavePath({
  time,
  loopDuration = 5, // seconds per loop
  offset = 0,
  frequency = 0.02,
  amplitude = 40,
  verticalShift = 160,
  width = 1440,
  height = 320,
  pointsCount = 16 // Increase for more complexity
}) {
  // Compute the current loop seed. This will change every loopDuration seconds.
  const loopSeed = Math.floor(time / loopDuration);
  // A helper to get the fractional part of a number.
  const fract = (x) => x - Math.floor(x);

  // Generate an array of points with added randomness that changes per loop.
  const points = [];
  for (let i = 0; i < pointsCount; i++) {
    const x = (width / (pointsCount - 1)) * i;
    // Use a pseudo-random function based on the loopSeed and control point index.
    const randomFactor = (fract(Math.sin((i + 1) * (loopSeed + offset)) * 10000) - 0.5) * (amplitude * 0.05);
    // Combine a smooth sine-based wave with the random factor.
    const y =
      verticalShift +
      Math.sin((x + time * 50) * frequency + offset) * amplitude +
      randomFactor;
    points.push([x, y]);
  }

  // Use a Catmull–Rom to cubic Bézier conversion to create a smooth curve.
  const tension = 0.9;
  let d = `M${points[0][0]},${points[0][1]}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i === 0 ? points[i] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : p2;
    const cp1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const cp1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const cp2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const cp2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }

  // Close the shape by drawing down to the bottom of the SVG and back to the start.
  d += ` L${width},${height} L0,${height} Z`;
  return d;
}

const App = () => {
  const [historicalData, setHistoricalData] = useState([]);
  const [realTime, setRealTime] = useState(null);
  const [avgSentiment, setAvgSentiment] = useState(null);
  const backendUrl = 'http://localhost:8000/bitcoin-pulse';

  // Controls for two wave layers.
  const waveControls1 = useAnimation();
  const waveControls2 = useAnimation();

  // This function fetches new data and then appends a new data point
  // with the current realTime price. You can also choose to replace the last point.
  const fetchData = async () => {
    try {
      const response = await axios.get(backendUrl);
      const { historical_data, real_time, average_historical_sentiment } = response.data;

      // Map historical data from backend.
      const baseHistorical = historical_data.map(point => ({
        date: new Date(point.date).toLocaleDateString(),
        price: Number(point.price),
        sentiment: Number(point.sentiment),
      }));

      // Create a new data point for the latest realTime price.
      const latestPoint = {
        date: new Date().toLocaleTimeString(),  // use time for the new point
        price: Number(real_time.price)
      };

      // Append the new data point.
      const updatedData = [...baseHistorical, latestPoint];
      setHistoricalData(updatedData);

      // Update realTime state.
      setRealTime({
        ...real_time,
        sentiment: Number(real_time.sentiment),
        price: Number(real_time.price),
        previous_price: Number(real_time.previous_price || real_time.price),
      });

      setAvgSentiment(Number(average_historical_sentiment));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  // Fetch data immediately and then every 5 seconds.
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Animate the wave shape.
  const [speedFactor] = useState(1);
  const time = useAnimatedTime(speedFactor);
    
  useEffect(() => {
    if (realTime?.sentiment != null) {
      const sentiment = realTime.sentiment;
      const baseDuration = 8 + (1 - sentiment) * 6;

      waveControls1.start({
        x: ['-100%', '0%'],
        transition: {
          duration: baseDuration,
          repeat: Infinity,
          ease: 'linear',
        },
      });

      waveControls2.start({
        x: ['-50%', '50%'],
        transition: {
          duration: baseDuration * 1.5,
          repeat: Infinity,
          ease: 'linear',
        },
      });
    }
  }, [realTime, waveControls1, waveControls2]);

  // Compute min and max price from historicalData for positioning the price label.
  const prices = historicalData.map((p) => p.price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const priceRange = maxPrice - minPrice || 1;
  const latestPrice = realTime ? realTime.price : 0;
  // Calculate vertical position: 0% at top = maxPrice, 100% at bottom = minPrice.
  const yPercent = 100 - ((latestPrice - minPrice) / priceRange) * 100;
  const sentiment = realTime ? realTime.sentiment : 0.5;

  // Generate a randomized gradient for the waves.
  const randomGradient = useMemo(() => {
    const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
    const color1 = `rgb(255, ${randomBetween(100, 150)}, ${randomBetween(0, 50)})`;
    const color2 = `rgb(255, ${randomBetween(100, 150)}, ${randomBetween(0, 50)})`;
    return { color1, color2 };
  }, []);

  // Use the updated historicalData as the chart key so that the chart is re-mounted on changes.
  // (Alternatively, you could simply rely on state updates if re-mounting is not desired.)
  const chartKey = updatedKey => updatedKey; // you can compute a key based on realTime.price or data length

    
  if (!realTime) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center text-xl">
        Loading Bitcoin Pulse...
      </div>
    );
  }

  return (
    <motion.div 
        className="min-h-screen flex flex-col items-center py-10 relative overflow-hidden"
        // Background gradient that subtly shifts with sentiment.
        animate={{
        background: sentiment > 0.5 ? 'linear-gradient(135deg, #000000, #1a1a1a)' : 'linear-gradient(135deg, #000000, #333333)'
        }}
        transition={{ duration: 2 }}
    >
      {/* 
        Render multiple morphing wave layers in a single <svg> 
      */}
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
            <svg
                viewBox="0 0 1440 320"
                preserveAspectRatio="none"
                style={{
                    mixBlendMode: 'screen',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '50vh',
                }}
            >
                <defs>
                    <linearGradient id="orangeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={randomGradient.color1} />
                      <stop offset="100%" stopColor={randomGradient.color2} />
                    </linearGradient>
                </defs>
                {/* Wave Layer #1: Large, subtle wave */}
                <motion.path
                    animate={{
                      // Recompute the path each frame as time changes
                        d: generateWavePath({
                            time,
                            loopDuration: 2,
                            offset: 0,
                            frequency: 0.015,
                            amplitude: 60,
                            verticalShift: 50,
                            width: 1440,
                            height: 320,
                            pointsCount: 16
                        }),
                        // Animate blur or opacity for a glowing effect
                        filter: [`blur(50px)`, `blur(60px)`, `blur(50px)`],
                    }}
                    transition={{
                      // We want the path to update every frame, so no explicit duration needed for 'd'.
                      // For filter, we do a slow ping-pong
                        filter: { duration: 5, repeat: Infinity, repeatType: 'reverse' },
                    }}
                    fill="url(#orangeGradient)"
                    style={{ opacity: 0.2 }}
                />
            
                {/* Wave Layer #2: Medium wave, different frequency */}
                <motion.path
                    animate={{
                        d: generateWavePath({
                            time,
                            loopDuration: 2,
                            offset: 2,
                            frequency: 0.02,
                            amplitude: 50,
                            verticalShift: 160,
                            width: 1440,
                            height: 320,
                            pointsCount: 12
                        }),
                        filter: [`blur(30px)`, `blur(40px)`, `blur(30px)`],
                    }}
                    transition={{
                      filter: { duration: 4, repeat: Infinity, repeatType: 'reverse' },
                    }}
                    fill="url(#orangeGradient)"
                    style={{ opacity: 0.35 }}
                />
            
                {/* Wave Layer #3: Smaller, faster wave for detail */}
                <motion.path
                    animate={{
                        d: generateWavePath({
                            time,
                            loopDuration: 2,
                            offset: 4,
                            frequency: 0.03,
                            amplitude: 40,
                            verticalShift: 230,
                            width: 1440,
                            height: 320,
                            pointsCount: 10
                        }),
                        filter: [`blur(10px)`, `blur(20px)`, `blur(10px)`],
                    }}
                transition={{
                  filter: { duration: 3, repeat: Infinity, repeatType: 'reverse' },
                }}
                fill="url(#orangeGradient)"
                style={{ opacity: 0.5 }}
                />
            </svg>

            {/* Reflected Waves */}
            <svg
                viewBox="0 0 1440 320"
                preserveAspectRatio="none"
                style={{
                    mixBlendMode: 'screen',
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: '50vh',
                    transform: 'scaleY(-1)',
                }}
            >
              {/* Wave Layer #1: Large, subtle wave */}
                <motion.path
                animate={{
                  // Recompute the path each frame as time changes
                    d: generateWavePath({
                        time,
                        loopDuration: 2,
                        offset: 0,
                        frequency: 0.015,
                        amplitude: 60,
                        verticalShift: 60,
                        width: 1440,
                        height: 320,
                        pointsCount: 16
                    }),
                    // Animate blur or opacity for a glowing effect
                    filter: [`blur(50px)`, `blur(60px)`, `blur(50px)`],
                }}
                transition={{
                  // We want the path to update every frame, so no explicit duration needed for 'd'.
                  // For filter, we do a slow ping-pong
                    filter: { duration: 5, repeat: Infinity, repeatType: 'reverse' },
                }}
                fill="url(#orangeGradient)"
                style={{ opacity: 0.2 }}
                />
            
              {/* Wave Layer #2: Medium wave, different frequency */}
                <motion.path
                    animate={{
                        d: generateWavePath({
                            time,
                            loopDuration: 2,
                            offset: 2,
                            frequency: 0.02,
                            amplitude: 50,
                            verticalShift: 140,
                            width: 1440,
                            height: 320,
                            pointsCount: 12
                        }),
                        filter: [`blur(30px)`, `blur(40px)`, `blur(30px)`],
                    }}
                    transition={{
                      filter: { duration: 4, repeat: Infinity, repeatType: 'reverse' },
                    }}
                    fill="url(#orangeGradient)"
                    style={{ opacity: 0.35 }}
                />
            
                {/* Wave Layer #3: Smaller, faster wave for detail */}
                <motion.path
                    animate={{
                        d: generateWavePath({
                            time,
                            loopDuration: 2,
                            offset: 4,
                            frequency: 0.03,
                            amplitude: 40,
                            verticalShift: 230,
                            width: 1440,
                            height: 320,
                            pointsCount: 10
                        }),
                        filter: [`blur(10px)`, `blur(20px)`, `blur(10px)`],
                    }}
                transition={{
                  filter: { duration: 3, repeat: Infinity, repeatType: 'reverse' },
                }}
                fill="url(#orangeGradient)"
                style={{ opacity: 0.5 }}
                />
            </svg>
        </div>



        {/* Bitcoin Heartbeat/Pulse Chart */}
        <ResponsiveContainer 
            key={historicalData.length}
            width="100%" 
            height={600} 
            style={{ 
                backgroundColor: 'transparent',
                position: 'absolute',
                top: '40%'
            }}
        >
          <LineChart data={historicalData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
            <XAxis dataKey="date" hide={true} />
            <Line
              type="natural"
              dataKey="price"
              stroke="#f97316"
              strokeWidth={8}
              dot={false}
              isAnimationActive={false}
              shape={(props) => {
                return (
                  <>
                    {/* Main heartbeat line */}
                    <motion.path
                      d={props.d}
                      stroke="#f97316"
                      strokeWidth={6}
                      fill="none"
                      strokeDasharray="1"
                      pathLength="1"
                      initial={{ strokeDashoffset: 1000 }}
                      animate={{ strokeDashoffset: 0 }}
                      transition={{
                        duration: 1,
                        ease: "easeInOut",
                        repeat: Infinity,
                        repeatDelay: 0.8
                      }}
                      style={props.style}
                    />
                    {/* Trailing shadow */}
                    <motion.path
                      d={props.d}
                      stroke="#ffa726" // a lighter orange
                      strokeWidth={6}
                      fill="none"
                      strokeDasharray="1"
                      pathLength="1"
                      initial={{ strokeDashoffset: 1000 }}
                      animate={{ strokeDashoffset: 0 }}
                      transition={{
                        duration: 1,
                        ease: "easeInOut",
                        repeat: Infinity,
                        repeatDelay: 0.8,
                        delay: 0.2 // slight delay to simulate a trailing effect
                      }}
                      style={{
                        ...props.style,
                        opacity: 0.5,
                      }}
                    />
                  </>
                );
              }}
            >
              <LabelList
                dataKey="price"
                content={(props) => {
                  // Render the label for the last data point using realTime.price
                  const { x, y, index } = props;
                  if (index === historicalData.length - 1) {
                    return (
                      <text x={x - 380} y={y - 20} fill="#ffffff" fontSize={60} fontWeight="bold">
                        BTC ${realTime.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
    </motion.div>
  );
};

export default App;
