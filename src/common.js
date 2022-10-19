import fse from 'fs-extra';
import tmp from 'tmp';


function tmpdir(callback) {
  // uncomment for local debugging, this leaves folder with git repo alive, so you can check it.
  // run: `shopt -s dotglob` to allow cleanup folder with .dirs with
  // cleanup command, to allow re-checkout: `rm -rf /full_path_to_local_temp_folder/*`

  // return new Promise((resolve, reject) => {
  //   return callback("full_path_to_local_temp_folder");
  // });


  async function handle(path) {
    try {
      return await callback(path);
    } finally {
      await fse.remove(path);
    }
  }

  return new Promise((resolve, reject) => {
    tmp.dir((err, path) => {
      if (err) {
        reject(err);
      } else {
        handle(path).then(resolve, reject);
      }
    });
  });
}


export { tmpdir }