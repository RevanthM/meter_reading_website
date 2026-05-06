/**
 * Full-viewport hero for auth pages. Asset: `public/login-hero.png` (object-fit cover, anchored right).
 */
const LoginSplitArt: React.FC = () => (
  <div className="login-split-art__photo-wrap">
    <img
      className="login-split-art__photo"
      src={`${import.meta.env.BASE_URL}login-hero.png`}
      width={1024}
      height={682}
      alt=""
      decoding="async"
      fetchPriority="high"
    />
  </div>
);

export default LoginSplitArt;
